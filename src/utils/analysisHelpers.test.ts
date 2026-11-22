import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultChecklist,
  buildSearchUrl,
  calculateChecklistProgress,
  getChecklistVerdictMeta,
  getOverallStatusMeta,
} from './analysisHelpers';

test('getOverallStatusMeta returns non-definitive Korean labels', () => {
  assert.equal(getOverallStatusMeta('needs_verification').label, '추가 검증 필요');
  assert.equal(getOverallStatusMeta('caution_found').label, '주의할 요소 발견');
  assert.equal(getOverallStatusMeta('low_risk_observed').label, '확인할 만한 위험 요소가 적음');
});

test('getChecklistVerdictMeta returns clear Korean AI verdict labels', () => {
  assert.equal(getChecklistVerdictMeta('예').label, 'AI 판정: 충족 (예)');
  assert.equal(getChecklistVerdictMeta('아니오').label, 'AI 판정: 미충족 (아니오)');
  assert.equal(getChecklistVerdictMeta('확인 필요').label, 'AI 판정: 확인 필요');
});

test('buildDefaultChecklist includes 5 core items plus up to 2 claim-specific items', () => {
  const items = buildDefaultChecklist([
    {
      id: 'c1',
      claim: '하루 한 알로 혈관 나이가 20년 젊어진다',
      specificFiguresAndFacts: ['20년'],
      evidenceNeeds: '임상시험 원문 확인 필요',
    },
    {
      id: 'c2',
      claim: '국내 대학병원 연구진 100% 인증',
      specificFiguresAndFacts: ['100%'],
      evidenceNeeds: '공식 인증 기관 여부 확인',
    },
    {
      id: 'c3',
      claim: '세 번째 주장은 동적 체크리스트 상한을 넘김',
      specificFiguresAndFacts: [],
      evidenceNeeds: '확인 필요',
    },
  ]);

  assert.equal(items.length, 7);
  assert.equal(items[5].category, '주장별 검증');
  assert.equal(items[6].category, '주장별 검증');
});

test('calculateChecklistProgress counts AI verdicts and checked progress accurately', () => {
  const empty = calculateChecklistProgress([]);
  assert.deepEqual(empty, {
    total: 0,
    passed: 0,
    failed: 0,
    needsCheck: 0,
    checked: 0,
    percentage: 0,
  });

  const items = buildDefaultChecklist([]);
  items[0].aiVerdict = '예';
  items[0].checked = true;
  items[1].aiVerdict = '아니오';
  items[1].checked = true;
  const progress = calculateChecklistProgress(items);
  assert.deepEqual(progress, {
    total: 5,
    passed: 1,
    failed: 1,
    needsCheck: 3,
    checked: 2,
    percentage: 40,
  });
});

test('buildSearchUrl encodes Korean search queries properly', () => {
  const url = buildSearchUrl('식약처 건강기능식품 허위과대광고 조회');
  assert.equal(
    url,
    'https://www.google.com/search?q=%EC%8B%9D%EC%95%BD%EC%B2%98%20%EA%B1%B4%EA%B0%95%EA%B8%B0%EB%8A%A5%EC%8B%9D%ED%92%88%20%ED%97%88%EC%9C%84%EA%B3%BC%EB%8C%80%EA%B4%91%EA%B3%A0%20%EC%A1%B0%ED%9A%8C'
  );
});
