import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckSquare,
  ExternalLink,
  FileSearch,
  Film,
  Info,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { AnalysisReport } from '../types/analysis';
import {
  buildSearchUrl,
  calculateChecklistProgress,
  getChecklistVerdictMeta,
  getOverallStatusMeta,
} from '../utils/analysisHelpers';
import { getPlatformLabel } from '../utils/urlParser';

interface AnalysisReportViewProps {
  report: AnalysisReport;
  onOpenChecklist: () => void;
  onStartNew: () => void;
}

export const AnalysisReportView: React.FC<AnalysisReportViewProps> = ({
  report,
  onOpenChecklist,
  onStartNew,
}) => {
  const statusMeta = getOverallStatusMeta(report.overallStatus);
  const checklistProgress = calculateChecklistProgress(report.checklist);

  const StatusIcon =
    statusMeta.iconName === 'shield-alert'
      ? ShieldAlert
      : statusMeta.iconName === 'alert-triangle'
        ? AlertTriangle
        : ShieldCheck;

  const formattedTime = new Date(report.createdAt).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const videoInfo = report.analyzedVideoInfo;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 space-y-8">
      {/* Top Action & Meta Bar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>
              {report.inputMode === 'url'
                ? getPlatformLabel(report.platform)
                : report.inputMode === 'image'
                  ? '이미지 분석'
                  : '텍스트 분석'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formattedTime}</span>
            <span aria-hidden="true">·</span>
            <span>
              AI 체크리스트 충족 {checklistProgress.passed}/{checklistProgress.total}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            {report.contentTitle}
          </h1>
          {report.sourceUrl && (
            <p className="mt-1.5 text-xs font-mono text-slate-500 break-all">{report.sourceUrl}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenChecklist}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CheckSquare className="h-4 w-4" aria-hidden="true" />
            AI 체크리스트 상세 ({checklistProgress.total}항목)
          </button>
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            다른 콘텐츠 분석
          </button>
        </div>
      </div>

      {/* 0. 어떤 영상/콘텐츠를 분석했는지 안내 */}
      <section
        aria-labelledby="analyzed-subject-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3.5">
          <Film className="h-5 w-5 text-blue-700 shrink-0" aria-hidden="true" />
          <h2 id="analyzed-subject-heading" className="text-base font-bold text-slate-950">
            분석한 영상 · 콘텐츠 정보
          </h2>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {videoInfo?.thumbnailUrl && (
            <img
              src={videoInfo.thumbnailUrl}
              alt={videoInfo.title || report.contentTitle}
              referrerPolicy="no-referrer"
              className="h-32 w-56 rounded-xl border border-slate-200 object-cover shrink-0 bg-slate-100"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            {(videoInfo?.title || videoInfo?.author) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {videoInfo.title && (
                  <span className="font-semibold text-slate-950 text-sm">{videoInfo.title}</span>
                )}
                {videoInfo.author && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>채널/작성자: {videoInfo.author}</span>
                  </>
                )}
              </div>
            )}

            <p className="text-sm leading-relaxed text-slate-700">
              {videoInfo?.whatVideoIsAbout || report.inputSummary}
            </p>

            {videoInfo?.whatVideoIsAbout &&
              report.inputSummary &&
              videoInfo.whatVideoIsAbout !== report.inputSummary && (
                <p className="text-xs leading-relaxed text-slate-600 pt-1">
                  <span className="font-semibold text-slate-800">핵심 요약: </span>
                  {report.inputSummary}
                </p>
              )}

            {report.extractedImageText && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-700">이미지에서 추출된 텍스트</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {report.extractedImageText}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 1. 종합 신뢰성 분석 결과 */}
      <section aria-labelledby="overall-summary-heading">
        <div className={`rounded-2xl border p-6 ${statusMeta.containerClass}`}>
          <div className="flex items-start gap-3.5">
            <StatusIcon
              className={`mt-0.5 h-6 w-6 shrink-0 ${statusMeta.badgeTextClass}`}
              aria-hidden="true"
            />
            <div className="space-y-2">
              <h2 id="overall-summary-heading" className="text-lg font-bold">
                종합 검토 의견: {statusMeta.label}
              </h2>
              <p className="text-sm leading-relaxed">
                {report.overallSummary || statusMeta.description}
              </p>
              <p className="pt-1 text-xs leading-relaxed opacity-85">{report.disclaimer}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. AI가 직접 점검한 신뢰성 체크리스트 요약 */}
      <section
        aria-labelledby="ai-checklist-summary-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="ai-checklist-summary-heading" className="text-lg font-bold text-slate-950">
              AI 신뢰성 체크리스트 점검 결과
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              AI가 콘텐츠 내용을 기준으로 주요 신뢰성 항목을 직접 점검한 결과입니다.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700 shrink-0">
            <span className="text-emerald-800 font-semibold">충족 {checklistProgress.passed}</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-800 font-semibold">미충족 {checklistProgress.failed}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-800 font-semibold">
              확인 필요 {checklistProgress.needsCheck}
            </span>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {report.checklist.map((item) => {
            const verdictMeta = getChecklistVerdictMeta(item.aiVerdict);
            return (
              <div key={item.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-950">{item.question}</p>
                  <span
                    className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shrink-0 w-fit ${verdictMeta.badgeClass}`}
                  >
                    {verdictMeta.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{item.aiReason}</p>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onOpenChecklist}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            체크리스트 화면에서 자세히 보기
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* 3. 핵심 주장 및 수치 추출 */}
      <section
        aria-labelledby="core-claims-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5"
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 id="core-claims-heading" className="text-lg font-bold text-slate-950">
              핵심 주장 및 수치·사실 정보
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              콘텐츠에 포함된 주요 주장을 개별 항목으로 분리해 정리했습니다.
            </p>
          </div>
          <span className="font-mono text-xs font-medium text-slate-600 tabular-nums shrink-0">
            총 {report.coreClaims.length}개 주장
          </span>
        </div>

        {report.coreClaims.length === 0 ? (
          <p className="text-sm text-slate-600">구분할 만한 명시적 사실 주장이 추출되지 않았습니다.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {report.coreClaims.map((claim, index) => (
              <article key={claim.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums shrink-0">
                    주장 {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-base font-semibold text-slate-950 leading-snug">
                    {claim.claim}
                  </h3>
                </div>

                {claim.specificFiguresAndFacts.length > 0 && (
                  <div className="pl-0 sm:pl-14 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">포함된 수치·사실: </span>
                    <span>{claim.specificFiguresAndFacts.join(' · ')}</span>
                  </div>
                )}

                <div className="pl-0 sm:pl-14 text-xs leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-800">필요한 검증 근거: </span>
                  <span>{claim.evidenceNeeds}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 4. 과장 및 오해 유발 표현 분석 */}
      <section
        aria-labelledby="exaggeration-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5"
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 id="exaggeration-heading" className="text-lg font-bold text-slate-950">
              과장 및 오해 유발 표현 분석
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              판단을 흐리거나 조급함·불안을 유도할 수 있는 표현과 주의 이유입니다.
            </p>
          </div>
          <span className="font-mono text-xs font-medium text-slate-600 tabular-nums shrink-0">
            {report.exaggeratedExpressions.length}건 탐지
          </span>
        </div>

        {report.exaggeratedExpressions.length === 0 ? (
          <p className="text-sm text-slate-600">
            뚜렷한 과장 표현이나 감정적 오해 유발 문구가 발견되지 않았습니다.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {report.exaggeratedExpressions.map((expr) => (
              <div key={expr.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-amber-800">{expr.category}</span>
                </div>
                <blockquote className="text-sm font-semibold text-slate-950">
                  “{expr.phrase}”
                </blockquote>
                <p className="text-sm leading-relaxed text-slate-600">{expr.reason}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. 출처 및 근거 확인 + 6. AI 생성 가능성 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
        <section
          aria-labelledby="sources-heading"
          className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <FileSearch className="h-5 w-5 text-blue-700 shrink-0" aria-hidden="true" />
            <h2 id="sources-heading" className="text-lg font-bold text-slate-950">
              출처 및 근거 확인
            </h2>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-950">
            <p className="font-semibold">외부 출처 미검증 안내</p>
            <p className="mt-1">{report.sourceAssessment.unverifiedWarning}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-900">
              콘텐츠 내 출처 제시 여부:{' '}
              <span
                className={
                  report.sourceAssessment.hasCitedSources ? 'text-emerald-800' : 'text-rose-800'
                }
              >
                {report.sourceAssessment.hasCitedSources ? '출처 표기 일부 있음' : '구체적 출처 부족'}
              </span>
            </p>
            <p className="text-sm leading-relaxed text-slate-600">
              {report.sourceAssessment.citedSourcesSummary}
            </p>
          </div>

          {report.sourceAssessment.claimsRequiringStatisticsOrStudies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-900">
                통계·연구 자료 확인이 필요한 주장
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                {report.sourceAssessment.claimsRequiringStatisticsOrStudies.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {report.sourceAssessment.recommendedOfficialSources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-900">확인할 공식·객관적 자료</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                {report.sourceAssessment.recommendedOfficialSources.map((src, i) => (
                  <li key={i}>{src}</li>
                ))}
              </ul>
            </div>
          )}

          {report.sourceAssessment.recommendedSearchQueries.length > 0 && (
            <div className="mt-auto pt-2 space-y-2">
              <p className="text-xs font-semibold text-slate-900">직접 검증용 추천 검색어</p>
              <div className="flex flex-col gap-2">
                {report.sourceAssessment.recommendedSearchQueries.map((query, i) => (
                  <a
                    key={i}
                    href={buildSearchUrl(query)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-900"
                  >
                    <span className="inline-flex items-center gap-2 truncate">
                      <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                      <span className="truncate">{query}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <section
          aria-labelledby="ai-gen-heading"
          className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
            <Bot className="h-5 w-5 text-blue-700 shrink-0" aria-hidden="true" />
            <h2 id="ai-gen-heading" className="text-lg font-bold text-slate-950">
              AI 생성·합성 가능성 참고 의견
            </h2>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">관찰 수준 (참고 의견)</p>
            <p className="mt-1 text-base font-bold text-slate-950">
              {report.aiGenerationAssessment.likelihoodLevel}
            </p>
          </div>

          {report.aiGenerationAssessment.observedIndicators.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-900">관찰된 특징 및 정황</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                {report.aiGenerationAssessment.observedIndicators.map((ind, i) => (
                  <li key={i}>{ind}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-900">합성 음성·조작 가능성 의견</p>
            <p className="text-sm leading-relaxed text-slate-600">
              {report.aiGenerationAssessment.audioOrSynthesisNotes}
            </p>
          </div>

          <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <div>
                <p className="font-semibold text-slate-900">판별의 한계와 불확실성 안내</p>
                <p className="mt-1">{report.aiGenerationAssessment.uncertaintyExplanation}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 7. 추가 검증이 필요한 사항 */}
      <section
        aria-labelledby="next-steps-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div>
          <h2 id="next-steps-heading" className="text-lg font-bold text-slate-950">
            추가 검증이 필요한 사항
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            AI 분석 결과를 바탕으로 직접 확인해 보시면 좋은 다음 단계입니다.
          </p>
        </div>

        <ol className="space-y-2.5 pt-1">
          {report.additionalVerificationSteps.map((step, index) => (
            <li key={index} className="flex items-start gap-3 text-sm text-slate-700">
              <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums mt-0.5">
                {String(index + 1).padStart(2, '0')}.
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
