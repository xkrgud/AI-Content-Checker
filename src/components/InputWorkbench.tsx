import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Search,
  Share2,
  Upload,
  X,
} from 'lucide-react';
import type { InputMode, UrlInspectionResult } from '../types/analysis';
import { getPlatformLabel, validateAndNormalizeUrl } from '../utils/urlParser';

interface InputWorkbenchProps {
  inputMode: InputMode;
  onChangeMode: (mode: InputMode) => void;
  urlInput: string;
  onChangeUrlInput: (value: string) => void;
  contentTitle: string;
  onChangeContentTitle: (value: string) => void;
  textInput: string;
  onChangeTextInput: (value: string) => void;
  transcriptInput: string;
  onChangeTranscriptInput: (value: string) => void;
  imageDataUrl: string | null;
  imageFileName: string | null;
  onChangeImage: (dataUrl: string | null, fileName: string | null) => void;
  inspectionResult: UrlInspectionResult | null;
  onSetInspectionResult: (res: UrlInspectionResult | null) => void;
  sharedNotice: string | null;
  onDismissSharedNotice: () => void;
  errorMessage: string | null;
  onClearError: () => void;
  onStartAnalysis: () => void;
  isAnalyzing: boolean;
}

export const InputWorkbench: React.FC<InputWorkbenchProps> = ({
  inputMode,
  onChangeMode,
  urlInput,
  onChangeUrlInput,
  contentTitle,
  onChangeContentTitle,
  textInput,
  onChangeTextInput,
  transcriptInput,
  onChangeTranscriptInput,
  imageDataUrl,
  imageFileName,
  onChangeImage,
  inspectionResult,
  onSetInspectionResult,
  sharedNotice,
  onDismissSharedNotice,
  errorMessage,
  onClearError,
  onStartAnalysis,
  isAnalyzing,
}) => {
  const [inspectingUrl, setInspectingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleInspectUrl = async (targetUrl?: string) => {
    const candidate = (targetUrl ?? urlInput).trim();
    const validation = validateAndNormalizeUrl(candidate);
    if (!validation.valid || !validation.normalizedUrl) {
      setUrlError(validation.error || '올바른 URL을 입력해 주세요.');
      onSetInspectionResult(null);
      return;
    }

    setUrlError(null);
    onClearError();
    setInspectingUrl(true);

    try {
      const response = await fetch('/api/inspect-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validation.normalizedUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        setUrlError(data.error || '링크 정보를 확인하지 못했습니다.');
        onSetInspectionResult(null);
        return;
      }

      const inspected = data as UrlInspectionResult;
      onSetInspectionResult(inspected);
      onChangeUrlInput(inspected.normalizedUrl);

      if (inspected.title && !contentTitle) {
        onChangeContentTitle(inspected.title);
      }
      if (inspected.transcriptText) {
        onChangeTranscriptInput(inspected.transcriptText);
      } else if (inspected.descriptionText && !transcriptInput) {
        onChangeTranscriptInput(inspected.descriptionText);
      }
    } catch {
      setUrlError('네트워크 연결 오류로 링크 정보를 불러오지 못했습니다.');
    } finally {
      setInspectingUrl(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onClearError();

    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      setUrlError('PNG, JPG, WEBP, GIF 이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUrlError('이미지 파일 크기는 8MB 이하만 지원합니다.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChangeImage(reader.result, file.name);
        setUrlError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    onStartAnalysis();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-3xl">
        <p className="text-xs font-medium tracking-normal text-slate-500">
          콘텐츠 신뢰성 검토 · 미디어 리터러시 지원 도구
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl leading-tight">
          영상·이미지·텍스트의 주장과 근거를 스스로 판단할 수 있게 분석합니다
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          콘텐츠의 참·거짓을 단정하지 않습니다. 어떤 영상·내용인지 요약하고, 핵심 주장과 수치,
          과장 표현, 출처 필요성, AI 신뢰성 체크리스트 점검 결과까지 한 번에 정리해 드립니다.
        </p>
      </div>

      {sharedNotice && (
        <div
          role="status"
          className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-sm text-blue-950"
        >
          <div className="flex items-start gap-3">
            <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">외부 앱 공유 링크가 등록되었습니다</p>
              <p className="mt-0.5 text-xs leading-relaxed text-blue-900">{sharedNotice}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissSharedNotice}
            aria-label="공유 알림 닫기"
            className="rounded-md p-1 text-blue-700 hover:bg-blue-100 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div
            role="tablist"
            aria-label="콘텐츠 입력 방식"
            className="inline-flex rounded-lg bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'url'}
              onClick={() => {
                onChangeMode('url');
                onClearError();
                setUrlError(null);
              }}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inputMode === 'url'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              영상 링크
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'text'}
              onClick={() => {
                onChangeMode('text');
                onClearError();
                setUrlError(null);
              }}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inputMode === 'text'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              텍스트 입력
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputMode === 'image'}
              onClick={() => {
                onChangeMode('image');
                onClearError();
                setUrlError(null);
              }}
              className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                inputMode === 'image'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              이미지 업로드
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {inputMode === 'url' && (
            <>
              <div>
                <label htmlFor="url-input" className="block text-sm font-semibold text-slate-900">
                  YouTube (일반 · 쇼츠 · youtu.be) · Instagram 릴스 · SNS 영상 링크
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  YouTube 쇼츠(/shorts/ID) 및 단축 링크(youtu.be/ID)는 표준 watch 형식으로 변환해
                  영상을 직접 불러와 분석합니다.
                </p>
                <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
                  <input
                    id="url-input"
                    type="url"
                    value={urlInput}
                    onChange={(e) => {
                      onChangeUrlInput(e.target.value);
                      if (urlError) setUrlError(null);
                      onClearError();
                    }}
                    placeholder="https://www.youtube.com/shorts/... 또는 https://www.youtube.com/watch?v=..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleInspectUrl()}
                    disabled={inspectingUrl}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {inspectingUrl ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Search className="h-4 w-4" aria-hidden="true" />
                    )}
                    링크 정보 확인
                  </button>
                </div>
              </div>

              {inspectionResult && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    {inspectionResult.thumbnailUrl && (
                      <img
                        src={inspectionResult.thumbnailUrl}
                        alt={inspectionResult.title || '영상 썸네일'}
                        referrerPolicy="no-referrer"
                        className="h-24 w-40 rounded-lg border border-slate-200 object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          {getPlatformLabel(inspectionResult.platform)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {inspectionResult.accessStatus === 'extracted'
                            ? '영상 정보 확인됨'
                            : inspectionResult.accessStatus === 'metadata_only'
                              ? '기본 정보만 확인됨'
                              : '영상 본문 접근 제한'}
                        </span>
                        {inspectionResult.author && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{inspectionResult.author}</span>
                          </>
                        )}
                      </div>
                      {inspectionResult.title && (
                        <p className="text-sm font-semibold text-slate-900">
                          {inspectionResult.title}
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-slate-600">
                        {inspectionResult.accessMessage}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="url-transcript-input"
                  className="block text-sm font-semibold text-slate-900"
                >
                  영상 자막 · 핵심 발언 · 추가 메모 (선택 또는 비공개·외부 SNS 대체 입력)
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  YouTube 영상은 링크만 입력해도 바로 분석할 수 있습니다. 인스타그램 릴스 등 외부
                  플랫폼에서 영상을 직접 불러오기 어려운 경우 내용을 여기에 입력해 주세요.
                </p>
                <textarea
                  id="url-transcript-input"
                  rows={4}
                  value={transcriptInput}
                  onChange={(e) => {
                    onChangeTranscriptInput(e.target.value);
                    onClearError();
                  }}
                  placeholder="참고할 추가 맥락이나, 영상 접근이 제한된 플랫폼의 발언·자막을 입력할 수 있습니다."
                  className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>
            </>
          )}

          {inputMode === 'text' && (
            <>
              <div>
                <label htmlFor="text-title" className="block text-sm font-semibold text-slate-900">
                  콘텐츠 제목 또는 출처 메모 (선택)
                </label>
                <input
                  id="text-title"
                  type="text"
                  value={contentTitle}
                  onChange={(e) => onChangeContentTitle(e.target.value)}
                  placeholder="예: SNS 건강 정보 게시글, 단톡방 전달 메시지 등"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>
              <div>
                <label htmlFor="text-body" className="block text-sm font-semibold text-slate-900">
                  분석할 텍스트 본문
                </label>
                <textarea
                  id="text-body"
                  rows={7}
                  value={textInput}
                  onChange={(e) => {
                    onChangeTextInput(e.target.value);
                    onClearError();
                  }}
                  placeholder="신뢰성을 점검하고 싶은 SNS 게시물, 광고 문구, 기사 발췌문 또는 전달받은 메시지를 입력해 주세요."
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>
            </>
          )}

          {inputMode === 'image' && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-900">
                  이미지 파일 업로드 (스크린샷 · 카드뉴스 · 광고 이미지)
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  이미지에 포함된 텍스트와 시각적 요소를 함께 분석하며, AI 생성 이미지 가능성에
                  대한 참고 의견을 제공합니다.
                </p>

                <input
                  ref={fileInputRef}
                  id="image-upload-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleFileChange}
                  className="sr-only"
                />

                {!imageDataUrl ? (
                  <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                    <Upload className="h-8 w-8 text-slate-400" aria-hidden="true" />
                    <p className="mt-3 text-sm font-medium text-slate-800">
                      분석할 이미지를 선택하세요
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      PNG, JPG, WEBP, GIF · 최대 8MB
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 cursor-pointer"
                    >
                      파일 선택하기
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <img
                        src={imageDataUrl}
                        alt={imageFileName || '업로드된 분석 이미지'}
                        referrerPolicy="no-referrer"
                        className="max-h-56 rounded-lg border border-slate-200 object-contain bg-white"
                      />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                          <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                          <span>{imageFileName || '이미지 준비 완료'}</span>
                        </div>
                        <p className="text-xs text-slate-600">
                          이미지 내 글자와 시각적 특징을 분석할 준비가 되었습니다.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            다른 이미지 선택
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeImage(null, null)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            제거
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="image-context-input"
                  className="block text-sm font-semibold text-slate-900"
                >
                  함께 적혀 있던 게시글 문구 (선택)
                </label>
                <textarea
                  id="image-context-input"
                  rows={3}
                  value={textInput}
                  onChange={(e) => onChangeTextInput(e.target.value)}
                  placeholder="이미지와 함께 게시된 설명글이나 해시태그가 있다면 함께 입력해 주세요."
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>
            </>
          )}

          {(urlError || errorMessage) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
              <span>{urlError || errorMessage}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              AI 분석은 참고 정보이며, 최종 사실 판단과 교차 검증은 사용자가 직접 수행합니다.
            </p>
            <button
              type="submit"
              disabled={isAnalyzing}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  분석 진행 중
                </>
              ) : (
                '신뢰도 분석 시작'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
