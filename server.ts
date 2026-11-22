import 'dotenv/config';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  isPrivateOrReservedHostname,
  validateAndNormalizeUrl,
} from './src/utils/urlParser.ts';
import { CORE_CHECKLIST_QUESTIONS } from './src/utils/analysisHelpers.ts';
import type {
  AiGenerationAssessment,
  AnalyzedVideoInfo,
  ChecklistItem,
  ChecklistVerdict,
  CoreClaim,
  ExaggeratedExpression,
  InputMode,
  OverallStatus,
  PlatformType,
  SourceAssessment,
  UrlInspectionResult,
} from './src/types/analysis.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function isPrivateIpAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('ff')) return true;
    if (normalized.startsWith('::ffff:')) {
      const v4 = normalized.slice(7);
      return isPrivateIpAddress(v4);
    }
    return false;
  }
  return true;
}

async function assertPublicDnsResolution(targetUrl: URL): Promise<void> {
  const host = targetUrl.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateOrReservedHostname(host)) {
    throw new Error('내부 네트워크 주소는 조회할 수 없습니다.');
  }
  if (net.isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new Error('사설 IP 주소는 조회할 수 없습니다.');
    }
    return;
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIpAddress(r.address))) {
    throw new Error('외부 공개 인터넷 주소만 조회할 수 있습니다.');
  }
}

async function safeFetchText(
  rawUrl: string,
  options: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxBytes = options.maxBytes ?? 1_500_000;
  let currentUrl = rawUrl;

  for (let hop = 0; hop < 3; hop += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('지원되지 않는 URL 프로토콜입니다.');
    }
    await assertPublicDnsResolution(parsed);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AIContentCheckerBot/1.0; +https://ai-content-checker.local)',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          ...(options.headers ?? {}),
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { ok: false, status: response.status, text: '', finalUrl: currentUrl };
        }
        const nextUrl = new URL(location, parsed);
        const validation = validateAndNormalizeUrl(nextUrl.toString());
        if (!validation.valid || !validation.normalizedUrl) {
          throw new Error('리다이렉트 대상 URL이 안전하지 않습니다.');
        }
        currentUrl = validation.normalizedUrl;
        continue;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return { ok: response.ok, status: response.status, text: '', finalUrl: currentUrl };
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return {
        ok: response.ok,
        status: response.status,
        text: decoder.decode(merged),
        finalUrl: currentUrl,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: 310, text: '', finalUrl: currentUrl };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaTag(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const patternB = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i'
  );
  const match = html.match(patternA) || html.match(patternB);
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

async function fetchYouTubeOEmbed(
  watchUrl: string
): Promise<{ title?: string; author?: string; thumbnailUrl?: string }> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const oembedRes = await safeFetchText(oembedUrl, { timeoutMs: 4500, maxBytes: 200_000 });
    if (oembedRes.ok && oembedRes.text) {
      const parsed = JSON.parse(oembedRes.text) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      return {
        title: parsed.title?.trim(),
        author: parsed.author_name?.trim(),
        thumbnailUrl: parsed.thumbnail_url?.trim(),
      };
    }
  } catch {
    // oEmbed failed
  }
  return {};
}

async function inspectYouTubeVideo(
  normalizedWatchUrl: string,
  videoId: string
): Promise<UrlInspectionResult> {
  const oembed = await fetchYouTubeOEmbed(normalizedWatchUrl);
  const title = oembed.title;
  const author = oembed.author;
  const thumbnailUrl = oembed.thumbnailUrl;

  if (title || author) {
    return {
      normalizedUrl: normalizedWatchUrl,
      platform: 'youtube',
      youtubeVideoId: videoId,
      title,
      author,
      thumbnailUrl,
      accessStatus: 'extracted',
      accessMessage:
        'YouTube 영상 정보가 확인되었습니다. 쇼츠 및 단축 링크는 표준 watch 형식으로 변환되었으며, AI가 영상을 직접 분석합니다.',
    };
  }

  return {
    normalizedUrl: normalizedWatchUrl,
    platform: 'youtube',
    youtubeVideoId: videoId,
    accessStatus: 'metadata_only',
    accessMessage:
      'YouTube 링크를 표준 watch 형식으로 변환했습니다. 분석 시작 시 Gemini 영상 입력으로 직접 불러오기를 시도합니다.',
  };
}

async function inspectGeneralSocialUrl(
  normalizedUrl: string,
  platform: PlatformType
): Promise<UrlInspectionResult> {
  try {
    const res = await safeFetchText(normalizedUrl, { timeoutMs: 5500, maxBytes: 1_000_000 });
    if (res.ok && res.text) {
      const title = extractMetaTag(res.text, 'og:title') || extractHtmlTitle(res.text);
      const descriptionText =
        extractMetaTag(res.text, 'og:description') || extractMetaTag(res.text, 'description');

      const hasUsefulText = Boolean(
        (title && !/login|instagram|tiktok/i.test(title)) ||
          (descriptionText && descriptionText.length > 20)
      );

      if (hasUsefulText) {
        return {
          normalizedUrl,
          platform,
          title,
          descriptionText,
          accessStatus: 'metadata_only',
          accessMessage:
            '게시물의 공개 제목·설명 일부만 가져왔습니다. 실제 영상 파일은 플랫폼 제한으로 직접 불러올 수 없으므로, 아래에 영상 내용이나 자막을 입력해 주세요.',
        };
      }
    }
  } catch {
    // Platform blocked automated request or timed out
  }

  return {
    normalizedUrl,
    platform,
    accessStatus: 'inaccessible',
    accessMessage:
      '공유 링크가 등록되었습니다. 해당 플랫폼의 접근 제한으로 영상을 직접 불러올 수 없으니, 영상의 주요 발언이나 화면 텍스트를 아래에 입력해 주세요.',
  };
}

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    videoAccessible: {
      type: Type.BOOLEAN,
      description:
        '영상 입력(fileData)이 전달된 경우 실제로 영상을 불러와 시청/청취할 수 있었으면 true, 비공개·삭제·접근 불가 등으로 영상을 불러오지 못했으면 반드시 false. 텍스트나 이미지 입력만 있을 때는 true.',
    },
    contentTitle: {
      type: Type.STRING,
      description: '분석한 영상 또는 콘텐츠의 주제를 한눈에 알 수 있는 명확한 한국어 제목',
    },
    whatVideoIsAbout: {
      type: Type.STRING,
      description:
        '어떤 영상(또는 콘텐츠)인지 구체적으로 설명하는 2~4문장. 영상 속 화자/장면/포맷/주요 맥락과 다루는 주제를 명확히 서술. 영상을 불러올 수 없으면 빈 문자열.',
    },
    inputSummary: {
      type: Type.STRING,
      description: '콘텐츠가 전달하려는 핵심 내용 요약 2~3문장',
    },
    extractedImageText: {
      type: Type.STRING,
      description:
        '이미지 입력인 경우 이미지 내부에서 읽어낸 글자와 숫자 정보. 이미지가 아니면 빈 문자열.',
    },
    overallStatus: {
      type: Type.STRING,
      description:
        '반드시 다음 3가지 값 중 하나만 선택: "needs_verification" (추가 검증 필요), "caution_found" (주의할 요소 발견), "low_risk_observed" (확인할 만한 위험 요소가 적음)',
    },
    overallSummary: {
      type: Type.STRING,
      description:
        '종합 신뢰성 분석 요약. 참/거짓을 단정하지 않고, 어떤 점 때문에 추가 검증이나 주의가 필요한지 설명.',
    },
    coreClaims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          claim: {
            type: Type.STRING,
            description: '콘텐츠가 전달하는 개별 핵심 주장',
          },
          specificFiguresAndFacts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '주장에 포함된 구체적 수치, 기간, 비율, 기관명, 사실 요소',
          },
          evidenceNeeds: {
            type: Type.STRING,
            description: '이 주장을 검증하기 위해 어떤 근거가 필요한지 설명',
          },
        },
        required: ['id', 'claim', 'specificFiguresAndFacts', 'evidenceNeeds'],
      },
    },
    exaggeratedExpressions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          phrase: {
            type: Type.STRING,
            description: '원문 또는 영상 발화에서 발견된 과장·오해 유발 표현 인용',
          },
          category: {
            type: Type.STRING,
            description:
              '다음 중 하나: "과장 표현", "근거 없는 확신", "공포·불안 유발", "소비자 오해 유발", "광고·홍보성 표현"',
          },
          reason: {
            type: Type.STRING,
            description: '이 표현이 사용자의 판단에 영향을 줄 수 있어 주의가 필요한 이유',
          },
        },
        required: ['id', 'phrase', 'category', 'reason'],
      },
    },
    sourceAssessment: {
      type: Type.OBJECT,
      properties: {
        hasCitedSources: {
          type: Type.BOOLEAN,
          description: '콘텐츠 내에 구체적이고 검증 가능한 출처가 명시되어 있는지 여부',
        },
        citedSourcesSummary: {
          type: Type.STRING,
          description: '콘텐츠에 제시된 출처 유무와 그 구체성 평가',
        },
        claimsRequiringStatisticsOrStudies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '통계, 임상시험, 학술 연구 등 객관적 자료 확인이 필요한 주장 목록',
        },
        unverifiedWarning: {
          type: Type.STRING,
          description:
            '외부 자료를 실제로 실시간 조회·검증하지 않았음을 알리고, 사용자가 직접 원문을 대조해야 함을 안내하는 문구',
        },
        recommendedOfficialSources: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '사용자가 직접 확인해 볼 수 있는 공신력 있는 공식 기관·자료 유형 안내',
        },
        recommendedSearchQueries: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '사용자가 사실 확인을 위해 직접 검색해 볼 수 있는 구체적인 한국어 검색어 3~5개',
        },
      },
      required: [
        'hasCitedSources',
        'citedSourcesSummary',
        'claimsRequiringStatisticsOrStudies',
        'unverifiedWarning',
        'recommendedOfficialSources',
        'recommendedSearchQueries',
      ],
    },
    aiGenerationAssessment: {
      type: Type.OBJECT,
      properties: {
        likelihoodLevel: {
          type: Type.STRING,
          description:
            '다음 중 하나: "가능성 낮음", "판별 불확실", "일부 AI 활용 가능성", "AI 생성·합성 의심 요소 발견"',
        },
        observedIndicators: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '영상/이미지/음성/텍스트에서 관찰된 AI 생성 또는 합성 관련 특징이나 정황',
        },
        audioOrSynthesisNotes: {
          type: Type.STRING,
          description: '합성 음성(TTS/AI 성우), 딥페이크, 이미지 생성/보정 가능성에 대한 참고 의견',
        },
        uncertaintyExplanation: {
          type: Type.STRING,
          description:
            'AI 생성 여부를 100% 확정할 수 없는 기술적 이유와 판별의 한계·불확실성 안내',
        },
      },
      required: [
        'likelihoodLevel',
        'observedIndicators',
        'audioOrSynthesisNotes',
        'uncertaintyExplanation',
      ],
    },
    checklistEvaluations: {
      type: Type.ARRAY,
      description:
        '신뢰성 체크리스트의 5가지 기본 검증 항목에 대해 AI가 콘텐츠를 직접 점검하여 판정("예", "아니오", "확인 필요")과 구체적 근거를 작성한 결과',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          question: { type: Type.STRING },
          aiVerdict: {
            type: Type.STRING,
            description: '반드시 다음 3가지 중 하나: "예", "아니오", "확인 필요"',
          },
          aiReason: {
            type: Type.STRING,
            description: '콘텐츠 내용을 근거로 해당 항목을 그렇게 판정한 구체적 이유 1~2문장',
          },
        },
        required: ['id', 'question', 'aiVerdict', 'aiReason'],
      },
    },
    additionalVerificationSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '사용자가 추가로 직접 점검할 수 있는 구체적인 검증 행동 3~5가지',
    },
  },
  required: [
    'videoAccessible',
    'contentTitle',
    'whatVideoIsAbout',
    'inputSummary',
    'extractedImageText',
    'overallStatus',
    'overallSummary',
    'coreClaims',
    'exaggeratedExpressions',
    'sourceAssessment',
    'aiGenerationAssessment',
    'checklistEvaluations',
    'additionalVerificationSteps',
  ],
};

function sanitizeOverallStatus(raw: string): OverallStatus {
  if (raw === 'needs_verification' || raw === 'caution_found' || raw === 'low_risk_observed') {
    return raw;
  }
  if (raw.includes('추가') || raw.includes('위험') || raw.includes('검증 필요')) {
    return 'needs_verification';
  }
  if (raw.includes('주의')) {
    return 'caution_found';
  }
  return 'caution_found';
}

function sanitizeChecklistVerdict(raw?: string): ChecklistVerdict {
  if (raw === '예' || raw === '아니오' || raw === '확인 필요') {
    return raw;
  }
  if (raw?.includes('예') && !raw.includes('아니오')) return '예';
  if (raw?.includes('아니오')) return '아니오';
  return '확인 필요';
}

const VALID_EXAGGERATION_CATEGORIES = new Set([
  '과장 표현',
  '근거 없는 확신',
  '공포·불안 유발',
  '소비자 오해 유발',
  '광고·홍보성 표현',
]);

const VALID_AI_LEVELS = new Set([
  '가능성 낮음',
  '판별 불확실',
  '일부 AI 활용 가능성',
  'AI 생성·합성 의심 요소 발견',
]);

async function generateWithRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isTransient = /503|502|500|timeout|ECONNRESET|UNAVAILABLE/i.test(msg);
      if (!isTransient || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.post('/api/inspect-url', async (req, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
      const validation = validateAndNormalizeUrl(rawUrl);
      if (!validation.valid || !validation.normalizedUrl || !validation.platform) {
        return res.status(400).json({ error: validation.error || '유효하지 않은 URL입니다.' });
      }

      if (validation.platform === 'youtube' && validation.youtubeVideoId) {
        const result = await inspectYouTubeVideo(
          validation.normalizedUrl,
          validation.youtubeVideoId
        );
        return res.json(result);
      }

      const result = await inspectGeneralSocialUrl(validation.normalizedUrl, validation.platform);
      return res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '링크 정보를 확인하는 중 오류가 발생했습니다.';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/analyze', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets 패널에서 API 키를 확인해 주세요.',
      });
    }

    try {
      const inputMode = req.body?.inputMode as InputMode;
      const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl.trim() : undefined;
      const contentTitle =
        typeof req.body?.contentTitle === 'string' ? req.body.contentTitle.trim() : '';
      const textContent =
        typeof req.body?.textContent === 'string' ? req.body.textContent.trim() : '';
      const transcriptOrNotes =
        typeof req.body?.transcriptOrNotes === 'string' ? req.body.transcriptOrNotes.trim() : '';
      const imageDataUrl =
        typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl.trim() : undefined;

      if (!['url', 'text', 'image'].includes(inputMode)) {
        return res.status(400).json({ error: '올바른 분석 입력 방식을 선택해 주세요.' });
      }

      let normalizedUrl = sourceUrl;
      let platform: PlatformType | undefined = req.body?.platform as PlatformType | undefined;
      let isYouTubeVideo = false;
      let youtubeMeta: { title?: string; author?: string; thumbnailUrl?: string } = {};

      if (inputMode === 'url') {
        const validation = validateAndNormalizeUrl(sourceUrl || '');
        if (!validation.valid || !validation.normalizedUrl || !validation.platform) {
          return res.status(400).json({ error: validation.error || '올바른 URL을 입력해 주세요.' });
        }
        normalizedUrl = validation.normalizedUrl;
        platform = validation.platform;
        isYouTubeVideo = platform === 'youtube' && Boolean(validation.youtubeVideoId);

        if (isYouTubeVideo) {
          youtubeMeta = await fetchYouTubeOEmbed(normalizedUrl);
        } else if (transcriptOrNotes.length < 8) {
          return res.status(422).json({
            error:
              '영상을 불러올 수 없어요. 이 링크는 플랫폼 제한으로 영상을 직접 불러올 수 없으니 아래 입력란에 영상 내용이나 자막을 입력해 주세요.',
          });
        }
      } else if (inputMode === 'text') {
        if (textContent.length < 8) {
          return res.status(400).json({ error: '분석할 텍스트를 8자 이상 입력해 주세요.' });
        }
      } else if (inputMode === 'image') {
        if (!imageDataUrl) {
          return res.status(400).json({ error: '분석할 이미지를 업로드해 주세요.' });
        }
      }

      type GeminiPart =
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
        | { fileData: { fileUri: string } };

      const parts: GeminiPart[] = [];

      if (isYouTubeVideo && normalizedUrl) {
        parts.push({
          fileData: {
            fileUri: normalizedUrl,
          },
        });
      }

      if (imageDataUrl) {
        const match = imageDataUrl.match(
          /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/
        );
        if (!match) {
          return res.status(400).json({
            error: 'PNG, JPG, WEBP, GIF 형식의 올바른 이미지 파일만 분석할 수 있습니다.',
          });
        }
        const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
        const base64Data = match[2];
        if (base64Data.length > 11_000_000) {
          return res.status(400).json({ error: '이미지 파일 용량은 8MB 이하만 지원합니다.' });
        }
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      }

      const checklistPromptSection = CORE_CHECKLIST_QUESTIONS.map(
        (q, idx) => `${idx + 1}. [id: ${q.id}] ${q.question}`
      ).join('\n');

      let promptText = '';
      if (isYouTubeVideo) {
        promptText = [
          '첨부된 유튜브 영상을 직접 시청 및 청취하여 신뢰도를 분석해 주세요.',
          '중요 원칙: 만약 영상을 실제로 불러오지 못하거나 비공개·오류 등으로 내용을 확인할 수 없다면, 절대 내용을 지어내거나 추측하지 말고 videoAccessible을 false로 설정하세요.',
          '영상을 정상적으로 불러왔다면:',
          '1) whatVideoIsAbout에 이 영상이 어떤 영상인지(주제, 진행 방식, 영상 속 장면과 발화 맥락)를 구체적으로 설명하세요.',
          '2) 핵심 주장과 수치, 과장·오해 유발 표현, 출처 제시 여부, AI 생성/합성 가능성을 분석하세요.',
          `3) 아래 신뢰성 체크리스트 5개 항목을 당신(AI)이 직접 점검하고 각 항목에 대해 "예", "아니오", "확인 필요" 중 하나와 구체적 이유(aiReason)를 checklistEvaluations에 모두 채워 주세요:\n${checklistPromptSection}`,
          transcriptOrNotes ? `\n[사용자가 추가로 적은 메모]\n${transcriptOrNotes}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
      } else if (inputMode === 'image') {
        const contextText = [
          contentTitle ? `[콘텐츠 제목]\n${contentTitle}` : '',
          textContent ? `[함께 입력된 설명]\n${textContent}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        promptText = [
          '첨부된 이미지를 분석해 주세요. whatVideoIsAbout에는 이 이미지가 어떤 유형의 이미지(광고 카드, 뉴스 캡처, 인포그래픽 등)인지 설명하고, 이미지 속 글자(OCR)를 extractedImageText에 정리하세요.',
          `또한 아래 신뢰성 체크리스트 5개 항목을 당신(AI)이 직접 점검하여 checklistEvaluations에 판정("예", "아니오", "확인 필요")과 이유를 모두 채워 주세요:\n${checklistPromptSection}`,
          contextText,
        ]
          .filter(Boolean)
          .join('\n\n');
      } else {
        const contextText = [
          contentTitle ? `[콘텐츠 제목]\n${contentTitle}` : '',
          textContent ? `[본문 텍스트]\n${textContent}` : '',
          transcriptOrNotes ? `[영상 자막/내용]\n${transcriptOrNotes}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        promptText = [
          '다음 콘텐츠를 신뢰성 관점에서 분석해 주세요. whatVideoIsAbout에는 이 콘텐츠가 어떤 내용과 목적을 가진 글/발언인지 설명해 주세요.',
          `또한 아래 신뢰성 체크리스트 5개 항목을 당신(AI)이 직접 점검하여 checklistEvaluations에 판정("예", "아니오", "확인 필요")과 이유를 모두 채워 주세요:\n${checklistPromptSection}`,
          contextText,
        ].join('\n\n');
      }

      parts.push({ text: promptText });

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const systemInstruction = `당신은 'AI Content Checker'의 중립적이고 객관적인 미디어 리터러시 및 콘텐츠 신뢰도 분석 전문가입니다.
반드시 한국어로 정중하고 명확하게 답변하며, 다음 원칙을 엄격히 준수하세요:

1. 영상을 불러오지 못했을 때는 절대 내용을 지어내지 마세요.
   - videoAccessible 필드를 정확히 판단하세요. 영상 내용을 실제로 확인하지 못했다면 videoAccessible = false로 반환하고 빈 내용을 남기세요.
2. 어떤 영상(콘텐츠)인지 명확히 설명하세요.
   - whatVideoIsAbout에 영상의 주제, 분위기, 구성, 화자/자막 내용 등 사용자가 "이 영상이 어떤 영상인지" 바로 이해할 수 있게 요약하세요.
3. 신뢰성 체크리스트는 사용자가 아닌 당신(AI)이 직접 점검해 채워 주세요.
   - 요청된 5가지 체크리스트 항목(id 포함)에 대해 각각 "예", "아니오", "확인 필요" 중 하나를 판정하고 구체적인 판단 근거를 작성하세요.
4. 절대 진실/거짓을 확정 판정하지 마세요.
   - 종합 결과는 반드시 "needs_verification", "caution_found", "low_risk_observed" 중 하나로 분류하세요.
5. 출처 및 근거 확인 원칙을 엄격히 지키세요.
   - 실제로 외부 웹사이트나 논문을 조회해 확인하지 않았으므로, 외부 출처가 검증되었다고 절대 표시하지 마세요.
6. AI 생성 콘텐츠 가능성은 보수적·객관적으로 분석하며, 판별의 한계와 불확실성을 함께 설명하세요.`;

      const runAnalysisCall = (modelName: string) =>
        ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: analysisResponseSchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

      let response;
      try {
        response = await runAnalysisCall('gemini-4-hydrogen');
      } catch (primaryErr) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        if (/503|UNAVAILABLE|high demand/i.test(primaryMsg)) {
          response = await generateWithRetry(() => runAnalysisCall('gemini-3.1-flash-lite'), 1);
        } else {
          throw primaryErr;
        }
      }

      const rawText = response.text?.trim();
      if (!rawText) {
        if (isYouTubeVideo) {
          return res.status(422).json({
            error: '영상을 불러올 수 없어요. 영상이 비공개이거나 현재 접근이 제한되어 있는지 확인해 주세요.',
          });
        }
        return res.status(502).json({
          error: 'AI 분석 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.',
        });
      }

      const parsed = JSON.parse(rawText) as {
        videoAccessible?: boolean;
        contentTitle?: string;
        whatVideoIsAbout?: string;
        inputSummary?: string;
        extractedImageText?: string;
        overallStatus?: string;
        overallSummary?: string;
        coreClaims?: CoreClaim[];
        exaggeratedExpressions?: ExaggeratedExpression[];
        sourceAssessment?: SourceAssessment;
        aiGenerationAssessment?: AiGenerationAssessment;
        checklistEvaluations?: Array<{
          id?: string;
          question?: string;
          aiVerdict?: string;
          aiReason?: string;
        }>;
        additionalVerificationSteps?: string[];
      };

      if (isYouTubeVideo && parsed.videoAccessible === false) {
        return res.status(422).json({
          error: '영상을 불러올 수 없어요. 비공개·삭제된 영상이거나 접근할 수 없는 유튜브 링크인지 확인해 주세요.',
        });
      }

      const coreClaims: CoreClaim[] = Array.isArray(parsed.coreClaims)
        ? parsed.coreClaims.map((item, idx) => ({
            id: item.id || `claim-${idx + 1}`,
            claim: item.claim || '',
            specificFiguresAndFacts: Array.isArray(item.specificFiguresAndFacts)
              ? item.specificFiguresAndFacts.filter(Boolean)
              : [],
            evidenceNeeds: item.evidenceNeeds || '객관적 출처 및 근거 확인 필요',
          }))
        : [];

      const exaggeratedExpressions: ExaggeratedExpression[] = Array.isArray(
        parsed.exaggeratedExpressions
      )
        ? parsed.exaggeratedExpressions.map((item, idx) => ({
            id: item.id || `expr-${idx + 1}`,
            phrase: item.phrase || '',
            category: VALID_EXAGGERATION_CATEGORIES.has(item.category)
              ? item.category
              : '과장 표현',
            reason: item.reason || '',
          }))
        : [];

      const sourceAssessment: SourceAssessment = {
        hasCitedSources: Boolean(parsed.sourceAssessment?.hasCitedSources),
        citedSourcesSummary:
          parsed.sourceAssessment?.citedSourcesSummary ||
          '콘텐츠 내 구체적인 출처 표기가 충분히 확인되지 않았습니다.',
        claimsRequiringStatisticsOrStudies: Array.isArray(
          parsed.sourceAssessment?.claimsRequiringStatisticsOrStudies
        )
          ? parsed.sourceAssessment.claimsRequiringStatisticsOrStudies.filter(Boolean)
          : [],
        unverifiedWarning:
          parsed.sourceAssessment?.unverifiedWarning ||
          '본 분석은 입력된 영상·텍스트·이미지 내용을 바탕으로 한 구조화 결과이며, 외부 원문 자료를 실시간 조회해 검증 완료한 것은 아닙니다.',
        recommendedOfficialSources: Array.isArray(
          parsed.sourceAssessment?.recommendedOfficialSources
        )
          ? parsed.sourceAssessment.recommendedOfficialSources.filter(Boolean)
          : ['국가기관 공식 보도자료 및 통계청·식약처 등 공신력 있는 데이터베이스'],
        recommendedSearchQueries: Array.isArray(parsed.sourceAssessment?.recommendedSearchQueries)
          ? parsed.sourceAssessment.recommendedSearchQueries.filter(Boolean)
          : [],
      };

      const rawAiLevel = parsed.aiGenerationAssessment?.likelihoodLevel || '판별 불확실';
      const aiGenerationAssessment: AiGenerationAssessment = {
        likelihoodLevel: VALID_AI_LEVELS.has(rawAiLevel)
          ? (rawAiLevel as AiGenerationAssessment['likelihoodLevel'])
          : '판별 불확실',
        observedIndicators: Array.isArray(parsed.aiGenerationAssessment?.observedIndicators)
          ? parsed.aiGenerationAssessment.observedIndicators.filter(Boolean)
          : [],
        audioOrSynthesisNotes:
          parsed.aiGenerationAssessment?.audioOrSynthesisNotes ||
          '음성 합성 또는 영상 조작 여부는 현재 확인 가능한 정보만으로 단정하기 어렵습니다.',
        uncertaintyExplanation:
          parsed.aiGenerationAssessment?.uncertaintyExplanation ||
          'AI 생성 탐지 결과는 참고 의견일 뿐이며, 편집·압축 과정이나 제한된 단서만으로는 생성 여부를 확정적으로 판별할 수 없습니다.',
      };

      const aiChecklistMap = new Map(
        (parsed.checklistEvaluations ?? []).map((item) => [item.id || '', item])
      );

      const checklist: ChecklistItem[] = CORE_CHECKLIST_QUESTIONS.map((q, idx) => {
        const matched =
          aiChecklistMap.get(q.id) || (parsed.checklistEvaluations ?? [])[idx];
        const aiVerdict = sanitizeChecklistVerdict(matched?.aiVerdict);
        return {
          id: q.id,
          question: q.question,
          category: '기본 검증',
          hint: q.hint,
          aiVerdict,
          aiReason:
            matched?.aiReason?.trim() ||
            '제시된 콘텐츠 내용에서 해당 항목의 충족 여부를 AI가 확인했습니다.',
          checked: aiVerdict === '예',
        };
      });

      coreClaims.slice(0, 2).forEach((claim, idx) => {
        checklist.push({
          id: `chk-claim-${idx + 1}`,
          question: `핵심 주장 "${claim.claim}"에 충분한 근거가 제시되었는가?`,
          category: '주장별 검증',
          hint: claim.evidenceNeeds,
          aiVerdict: '확인 필요',
          aiReason: claim.evidenceNeeds || '제시된 주장과 별도로 공신력 있는 자료 대조가 필요합니다.',
          checked: false,
        });
      });

      const resolvedTitle =
        youtubeMeta.title || parsed.contentTitle || contentTitle || '콘텐츠 신뢰도 분석 결과';

      const analyzedVideoInfo: AnalyzedVideoInfo = {
        title: youtubeMeta.title || parsed.contentTitle || contentTitle || undefined,
        author: youtubeMeta.author,
        thumbnailUrl: youtubeMeta.thumbnailUrl,
        normalizedUrl,
        whatVideoIsAbout: parsed.whatVideoIsAbout || parsed.inputSummary || '',
      };

      return res.json({
        contentTitle: resolvedTitle,
        analyzedVideoInfo,
        inputSummary: parsed.inputSummary || '',
        extractedImageText: parsed.extractedImageText || '',
        overallStatus: sanitizeOverallStatus(parsed.overallStatus || ''),
        overallSummary: parsed.overallSummary || '',
        disclaimer:
          '본 AI 분석 결과는 콘텐츠의 진실 여부를 확정 판정하지 않으며, 사용자의 비판적 판단과 추가 검증을 돕기 위한 참고 정보입니다.',
        coreClaims,
        exaggeratedExpressions,
        sourceAssessment,
        aiGenerationAssessment,
        checklist,
        additionalVerificationSteps: Array.isArray(parsed.additionalVerificationSteps)
          ? parsed.additionalVerificationSteps.filter(Boolean)
          : [],
        platform,
        normalizedUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/API_KEY_INVALID|403|PERMISSION_DENIED/i.test(msg)) {
        return res.status(403).json({
          error:
            'Gemini API 키가 유효하지 않거나 권한이 없습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인해 주세요.',
        });
      }
      if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
        return res.status(429).json({
          error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
      if (
        /fileData|fileUri|video|FAILED_PRECONDITION|NOT_FOUND|INVALID_ARGUMENT|Unable to fetch|cannot access/i.test(
          msg
        )
      ) {
        return res.status(422).json({
          error:
            '영상을 불러올 수 없어요. 비공개·삭제된 영상이거나 현재 접근할 수 없는 유튜브 링크인지 확인해 주세요.',
        });
      }
      if (/503|UNAVAILABLE|high demand/i.test(msg)) {
        return res.status(503).json({
          error:
            'AI 분석 모델에 일시적으로 요청이 몰리고 있습니다. 잠시 후 다시 분석을 시도해 주세요.',
        });
      }
      return res.status(500).json({
        error: 'AI 분석 요청을 처리하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Content Checker server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
