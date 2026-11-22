import type {
  ChecklistItem,
  ChecklistVerdict,
  CoreClaim,
  OverallStatus,
} from '../types/analysis.ts';

export interface OverallStatusMeta {
  label: string;
  description: string;
  containerClass: string;
  badgeTextClass: string;
  iconName: 'shield-alert' | 'alert-triangle' | 'shield-check';
}

export function getOverallStatusMeta(status: OverallStatus): OverallStatusMeta {
  switch (status) {
    case 'needs_verification':
      return {
        label: '추가 검증 필요',
        description:
          '근거가 불충분하거나 과장·확신 표현이 다수 발견되어 공신력 있는 자료로 교차 확인이 필요합니다.',
        containerClass: 'bg-rose-50 border-rose-200 text-rose-950',
        badgeTextClass: 'text-rose-800',
        iconName: 'shield-alert',
      };
    case 'caution_found':
      return {
        label: '주의할 요소 발견',
        description:
          '일부 과장·홍보성 표현이나 출처 보완이 필요한 주장이 포함되어 있어 주의 깊게 살펴보아야 합니다.',
        containerClass: 'bg-amber-50 border-amber-200 text-amber-950',
        badgeTextClass: 'text-amber-800',
        iconName: 'alert-triangle',
      };
    case 'low_risk_observed':
      return {
        label: '확인할 만한 위험 요소가 적음',
        description:
          '뚜렷한 과장 표현이나 근거 없는 단정은 적으나, 핵심 사실과 출처는 직접 한 번 더 확인하는 것이 좋습니다.',
        containerClass: 'bg-emerald-50 border-emerald-200 text-emerald-950',
        badgeTextClass: 'text-emerald-800',
        iconName: 'shield-check',
      };
  }
}

export function getChecklistVerdictMeta(verdict: ChecklistVerdict): {
  label: string;
  badgeClass: string;
} {
  switch (verdict) {
    case '예':
      return {
        label: 'AI 판정: 충족 (예)',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      };
    case '아니오':
      return {
        label: 'AI 판정: 미충족 (아니오)',
        badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
      };
    case '확인 필요':
      return {
        label: 'AI 판정: 확인 필요',
        badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
      };
  }
}

export function calculateChecklistProgress(items: ChecklistItem[]): {
  total: number;
  passed: number;
  failed: number;
  needsCheck: number;
  checked: number;
  percentage: number;
} {
  const total = items.length;
  if (total === 0) {
    return { total: 0, passed: 0, failed: 0, needsCheck: 0, checked: 0, percentage: 0 };
  }
  const passed = items.filter((item) => item.aiVerdict === '예').length;
  const failed = items.filter((item) => item.aiVerdict === '아니오').length;
  const needsCheck = items.filter((item) => item.aiVerdict === '확인 필요').length;
  const checked = items.filter((item) => item.checked).length;
  const percentage = Math.round((checked / total) * 100);
  return { total, passed, failed, needsCheck, checked, percentage };
}

export const CORE_CHECKLIST_QUESTIONS: Array<{
  id: string;
  question: string;
  hint: string;
}> = [
  {
    id: 'chk-evidence',
    question: '콘텐츠에 객관적인 근거(실험, 데이터, 공식 기록)가 제시되어 있는가?',
    hint: '단순 경험담이나 출처 없는 수치만 나열되어 있는지 AI가 점검합니다.',
  },
  {
    id: 'chk-source',
    question: '주장에 대한 출처(기관, 연구자, 원문 링크, 발행 시점)가 명확한가?',
    hint: '"전문가들에 따르면", "해외 연구 결과"처럼 모호하게 언급했는지 확인합니다.',
  },
  {
    id: 'chk-stats',
    question: '제시된 통계나 연구 결과를 공신력 있는 자료에서 확인할 수 있는 형태인가?',
    hint: '실제 기관명·논문명·통계 출처가 특정되어 대조 가능한지 점검합니다.',
  },
  {
    id: 'chk-exaggeration',
    question: '과장되거나 오해를 유발하는 표현 없이 절제된 언어로 전달하고 있는가?',
    hint: '"무조건", "100%", "기적", "충격" 같은 과장·불안 유발 표현 여부를 점검합니다.',
  },
  {
    id: 'chk-cross-check',
    question: '단일 주장이나 홍보 목적에 치우치지 않고 균형 있는 맥락을 제공하는가?',
    hint: '반대 의견, 조건, 제한사항이나 광고성 목적이 숨어 있지 않은지 확인합니다.',
  },
];

export function buildDefaultChecklist(coreClaims: CoreClaim[]): ChecklistItem[] {
  const baseItems: ChecklistItem[] = CORE_CHECKLIST_QUESTIONS.map((q) => ({
    id: q.id,
    question: q.question,
    category: '기본 검증',
    hint: q.hint,
    aiVerdict: '확인 필요',
    aiReason: '아직 콘텐츠 분석이 실행되지 않았습니다. 콘텐츠를 분석하면 AI가 항목별로 직접 점검해 드립니다.',
    checked: false,
  }));

  const dynamicItems: ChecklistItem[] = coreClaims.slice(0, 2).map((claim, idx) => ({
    id: `chk-claim-${idx + 1}`,
    question: `핵심 주장 "${claim.claim}"에 충분한 근거가 제시되었는가?`,
    category: '주장별 검증',
    hint: claim.evidenceNeeds || '해당 주장을 뒷받침하는 공식 자료 여부를 점검합니다.',
    aiVerdict: '확인 필요',
    aiReason: claim.evidenceNeeds || '추가 확인이 필요합니다.',
    checked: false,
  }));

  return [...baseItems, ...dynamicItems];
}

export function buildSearchUrl(query: string): string {
  const trimmed = query.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
