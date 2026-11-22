export type InputMode = 'url' | 'text' | 'image';

export type PlatformType = 'youtube' | 'instagram' | 'tiktok' | 'threads' | 'web';

export type OverallStatus = 'needs_verification' | 'caution_found' | 'low_risk_observed';

export type ExaggerationCategory =
  | '과장 표현'
  | '근거 없는 확신'
  | '공포·불안 유발'
  | '소비자 오해 유발'
  | '광고·홍보성 표현';

export type AiLikelihoodLevel =
  | '가능성 낮음'
  | '판별 불확실'
  | '일부 AI 활용 가능성'
  | 'AI 생성·합성 의심 요소 발견';

export type ChecklistVerdict = '예' | '아니오' | '확인 필요';

export interface UrlInspectionResult {
  normalizedUrl: string;
  platform: PlatformType;
  youtubeVideoId?: string;
  title?: string;
  author?: string;
  thumbnailUrl?: string;
  transcriptText?: string;
  descriptionText?: string;
  accessStatus: 'extracted' | 'metadata_only' | 'inaccessible';
  accessMessage: string;
}

export interface CoreClaim {
  id: string;
  claim: string;
  specificFiguresAndFacts: string[];
  evidenceNeeds: string;
}

export interface ExaggeratedExpression {
  id: string;
  phrase: string;
  category: ExaggerationCategory;
  reason: string;
}

export interface SourceAssessment {
  hasCitedSources: boolean;
  citedSourcesSummary: string;
  claimsRequiringStatisticsOrStudies: string[];
  unverifiedWarning: string;
  recommendedOfficialSources: string[];
  recommendedSearchQueries: string[];
}

export interface AiGenerationAssessment {
  likelihoodLevel: AiLikelihoodLevel;
  observedIndicators: string[];
  audioOrSynthesisNotes: string;
  uncertaintyExplanation: string;
}

export interface ChecklistItem {
  id: string;
  question: string;
  category: '기본 검증' | '주장별 검증';
  hint: string;
  aiVerdict: ChecklistVerdict;
  aiReason: string;
  checked: boolean;
  note?: string;
}

export interface AnalyzedVideoInfo {
  title?: string;
  author?: string;
  thumbnailUrl?: string;
  normalizedUrl?: string;
  whatVideoIsAbout: string;
}

export interface AnalysisReport {
  id: string;
  createdAt: string;
  inputMode: InputMode;
  sourceUrl?: string;
  platform?: PlatformType;
  contentTitle: string;
  analyzedVideoInfo?: AnalyzedVideoInfo;
  inputSummary: string;
  extractedImageText?: string;
  overallStatus: OverallStatus;
  overallSummary: string;
  disclaimer: string;
  coreClaims: CoreClaim[];
  exaggeratedExpressions: ExaggeratedExpression[];
  sourceAssessment: SourceAssessment;
  aiGenerationAssessment: AiGenerationAssessment;
  additionalVerificationSteps: string[];
  checklist: ChecklistItem[];
}
