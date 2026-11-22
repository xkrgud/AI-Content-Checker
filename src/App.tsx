import { useEffect, useState } from 'react';
import { Header, type ActiveTab } from './components/Header';
import { InputWorkbench } from './components/InputWorkbench';
import { AnalysisProgress } from './components/AnalysisProgress';
import { AnalysisReportView } from './components/AnalysisReportView';
import { ChecklistView } from './components/ChecklistView';
import { ShareGuideView } from './components/ShareGuideView';
import { HistoryView } from './components/HistoryView';
import type {
  AnalysisReport,
  ChecklistItem,
  InputMode,
  UrlInspectionResult,
} from './types/analysis';
import { buildDefaultChecklist } from './utils/analysisHelpers';
import { extractShareTargetParams, validateAndNormalizeUrl } from './utils/urlParser';

const HISTORY_STORAGE_KEY = 'ai_content_checker_history_v1';

function loadSavedHistory(): AnalysisReport[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalysisReport[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyze');
  const [inputMode, setInputMode] = useState<InputMode>('url');
  const [urlInput, setUrlInput] = useState('');
  const [contentTitle, setContentTitle] = useState('');
  const [textInput, setTextInput] = useState('');
  const [transcriptInput, setTranscriptInput] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [inspectionResult, setInspectionResult] = useState<UrlInspectionResult | null>(null);

  const [sharedNotice, setSharedNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [currentReport, setCurrentReport] = useState<AnalysisReport | null>(null);
  const [standaloneChecklist] = useState<ChecklistItem[]>(() => buildDefaultChecklist([]));
  const [history, setHistory] = useState<AnalysisReport[]>(() => loadSavedHistory());

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 20)));
    } catch {
      // Ignore storage quota errors
    }
  }, [history]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const applySharedUrl = async (sharedUrl: string, sharedTitle?: string, sharedText?: string) => {
    setActiveTab('analyze');
    setCurrentReport(null);
    setInputMode('url');
    setUrlInput(sharedUrl);
    if (sharedTitle) setContentTitle(sharedTitle);
    if (sharedText && sharedText !== sharedUrl) {
      setTranscriptInput(sharedText);
    }

    const validation = validateAndNormalizeUrl(sharedUrl);
    if (!validation.valid || !validation.normalizedUrl) {
      setSharedNotice(
        '외부 앱에서 공유 데이터가 전달되었으나 유효한 링크 형식을 찾지 못했습니다. 링크를 확인해 주세요.'
      );
      return;
    }

    setUrlInput(validation.normalizedUrl);
    setSharedNotice(
      `공유된 링크(${validation.normalizedUrl})를 입력창에 자동 등록했습니다.`
    );

    try {
      const res = await fetch('/api/inspect-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validation.normalizedUrl }),
      });
      if (res.ok) {
        const data = (await res.json()) as UrlInspectionResult;
        setInspectionResult(data);
        if (data.title && !sharedTitle) setContentTitle(data.title);
        if (data.transcriptText) {
          setTranscriptInput(data.transcriptText);
        } else if (data.descriptionText && !sharedText) {
          setTranscriptInput(data.descriptionText);
        }
      }
    } catch {
      // Keep registered URL even if metadata inspection fails
    }
  };

  useEffect(() => {
    const shared = extractShareTargetParams(window.location.search);
    if (!shared.hasSharedParams) return;

    if (shared.url) {
      void applySharedUrl(shared.url, shared.title, shared.text);
    } else if (shared.text || shared.title) {
      setInputMode('text');
      if (shared.title) setContentTitle(shared.title);
      if (shared.text) setTextInput(shared.text);
      setSharedNotice('외부 앱에서 전달된 텍스트가 분석 입력창에 자동 등록되었습니다.');
    }

    if (window.history?.replaceState) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  const handleStartAnalysis = async () => {
    setErrorMessage(null);

    let normalizedUrl: string | undefined;
    let detectedPlatform = inspectionResult?.platform;

    if (inputMode === 'url') {
      const validation = validateAndNormalizeUrl(urlInput);
      if (!validation.valid || !validation.normalizedUrl || !validation.platform) {
        setErrorMessage(validation.error || '올바른 영상 또는 게시물 링크를 입력해 주세요.');
        return;
      }
      normalizedUrl = validation.normalizedUrl;
      detectedPlatform = validation.platform;
      setUrlInput(normalizedUrl);

      const isYouTube = detectedPlatform === 'youtube' && Boolean(validation.youtubeVideoId);
      if (!isYouTube && transcriptInput.trim().length < 8) {
        setErrorMessage(
          '영상을 불러올 수 없어요. 이 링크는 플랫폼 제한으로 영상을 직접 불러올 수 없으니 아래 입력란에 영상 내용이나 자막을 입력해 주세요.'
        );
        return;
      }
    } else if (inputMode === 'text') {
      if (textInput.trim().length < 8) {
        setErrorMessage('분석할 텍스트를 8자 이상 입력해 주세요.');
        return;
      }
    } else if (inputMode === 'image') {
      if (!imageDataUrl) {
        setErrorMessage('분석할 이미지 파일을 먼저 업로드해 주세요.');
        return;
      }
    }

    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMode,
          sourceUrl: normalizedUrl,
          platform: detectedPlatform,
          contentTitle: contentTitle.trim() || inspectionResult?.title || undefined,
          textContent: inputMode === 'text' || inputMode === 'image' ? textInput.trim() : undefined,
          transcriptOrNotes: inputMode === 'url' ? transcriptInput.trim() : undefined,
          imageDataUrl: inputMode === 'image' ? imageDataUrl : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.error || '콘텐츠 분석 중 오류가 발생했습니다.');
        setIsAnalyzing(false);
        return;
      }

      const checklist: ChecklistItem[] = Array.isArray(data.checklist)
        ? data.checklist
        : buildDefaultChecklist(data.coreClaims || []);

      const report: AnalysisReport = {
        id: `rep-${Date.now()}`,
        createdAt: new Date().toISOString(),
        inputMode,
        sourceUrl: data.normalizedUrl || normalizedUrl,
        platform: data.platform || detectedPlatform,
        contentTitle: data.contentTitle,
        analyzedVideoInfo: data.analyzedVideoInfo,
        inputSummary: data.inputSummary,
        extractedImageText: data.extractedImageText,
        overallStatus: data.overallStatus,
        overallSummary: data.overallSummary,
        disclaimer: data.disclaimer,
        coreClaims: data.coreClaims,
        exaggeratedExpressions: data.exaggeratedExpressions,
        sourceAssessment: data.sourceAssessment,
        aiGenerationAssessment: data.aiGenerationAssessment,
        additionalVerificationSteps: data.additionalVerificationSteps,
        checklist,
      };

      setCurrentReport(report);
      setHistory((prev) => [report, ...prev].slice(0, 20));
      setActiveTab('analyze');
    } catch {
      setErrorMessage('서버와 통신하지 못했습니다. 네트워크 연결 상태를 확인해 주세요.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResetToNew = () => {
    setCurrentReport(null);
    setErrorMessage(null);
    setActiveTab('analyze');
  };

  const activeChecklistItems = currentReport ? currentReport.checklist : standaloneChecklist;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        activeTab={activeTab}
        hasReport={Boolean(currentReport)}
        historyCount={history.length}
        onSelectTab={setActiveTab}
        onResetToNew={handleResetToNew}
      />

      <main className="flex-1">
        {isAnalyzing ? (
          <AnalysisProgress
            contentLabel={
              contentTitle || urlInput || imageFileName || textInput.slice(0, 60) || '콘텐츠'
            }
            onCancel={() => setIsAnalyzing(false)}
          />
        ) : activeTab === 'analyze' ? (
          currentReport ? (
            <AnalysisReportView
              report={currentReport}
              onOpenChecklist={() => setActiveTab('checklist')}
              onStartNew={handleResetToNew}
            />
          ) : (
            <InputWorkbench
              inputMode={inputMode}
              onChangeMode={setInputMode}
              urlInput={urlInput}
              onChangeUrlInput={setUrlInput}
              contentTitle={contentTitle}
              onChangeContentTitle={setContentTitle}
              textInput={textInput}
              onChangeTextInput={setTextInput}
              transcriptInput={transcriptInput}
              onChangeTranscriptInput={setTranscriptInput}
              imageDataUrl={imageDataUrl}
              imageFileName={imageFileName}
              onChangeImage={(dataUrl, fileName) => {
                setImageDataUrl(dataUrl);
                setImageFileName(fileName);
              }}
              inspectionResult={inspectionResult}
              onSetInspectionResult={setInspectionResult}
              sharedNotice={sharedNotice}
              onDismissSharedNotice={() => setSharedNotice(null)}
              errorMessage={errorMessage}
              onClearError={() => setErrorMessage(null)}
              onStartAnalysis={handleStartAnalysis}
              isAnalyzing={isAnalyzing}
            />
          )
        ) : activeTab === 'checklist' ? (
          <ChecklistView
            report={currentReport}
            items={activeChecklistItems}
            onBackToReport={() => setActiveTab('analyze')}
            onStartNew={handleResetToNew}
          />
        ) : activeTab === 'history' ? (
          <HistoryView
            reports={history}
            onSelectReport={(rep) => {
              setCurrentReport(rep);
              setActiveTab('analyze');
            }}
            onDeleteReport={(id) => {
              setHistory((prev) => prev.filter((r) => r.id !== id));
              if (currentReport?.id === id) {
                setCurrentReport(null);
              }
            }}
            onStartNew={handleResetToNew}
          />
        ) : (
          <ShareGuideView
            onSimulateShareTarget={(url, title) => {
              void applySharedUrl(url, title);
            }}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>AI Content Checker · 미디어 리터러시 지원 분석 도구</span>
          <span>
            AI 분석은 참고 정보이며, 출처 확인과 최종 사실 판단은 사용자가 직접 진행합니다.
          </span>
        </div>
      </footer>
    </div>
  );
}
