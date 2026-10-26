import type { Instrument } from './types';

/**
 * 시작용 기본 악기·파트 목록.
 * Supabase 에서는 seed_default_instruments() SQL 함수가 같은 목록을 만든다.
 * (두 목록이 같은지 tests 에서 확인한다)
 */
interface Seed {
  key: string;
  name: string;
  color: string;
  allowCustom?: boolean;
  parts?: { key: string; name: string; color?: string }[];
}

export const DEFAULT_INSTRUMENT_SEEDS: Seed[] = [
  {
    key: 'violin',
    name: '바이올린',
    color: '#2563eb',
    parts: [
      { key: 'vn1', name: '제1바이올린', color: '#2563eb' },
      { key: 'vn2', name: '제2바이올린', color: '#0891b2' },
    ],
  },
  { key: 'viola', name: '비올라', color: '#7c3aed' },
  { key: 'cello', name: '첼로', color: '#c2410c' },
  { key: 'bass', name: '더블베이스', color: '#92400e' },
  {
    key: 'flute',
    name: '플루트',
    color: '#16a34a',
    parts: [
      { key: 'fl1', name: '플루트 1' },
      { key: 'fl2', name: '플루트 2' },
    ],
  },
  {
    key: 'clarinet',
    name: '클라리넷',
    color: '#0d9488',
    parts: [
      { key: 'cl1', name: '클라리넷 1' },
      { key: 'cl2', name: '클라리넷 2' },
    ],
  },
  { key: 'oboe', name: '오보에', color: '#65a30d' },
  { key: 'bassoon', name: '바순', color: '#4d7c0f' },
  { key: 'horn', name: '호른', color: '#ca8a04' },
  { key: 'trumpet', name: '트럼펫', color: '#dc2626' },
  { key: 'trombone', name: '트롬본', color: '#be123c' },
  { key: 'tuba', name: '튜바', color: '#9f1239' },
  { key: 'perc', name: '타악기', color: '#475569' },
  { key: 'piano', name: '피아노', color: '#1f2937' },
  { key: 'other', name: '기타 / 직접 입력', color: '#64748b', allowCustom: true },
];

/** 데모 모드용 악기 목록 (ID 는 'demo-' 접두사) */
export function buildDefaultInstruments(prefix = 'demo-'): Instrument[] {
  return DEFAULT_INSTRUMENT_SEEDS.map((s, i) => ({
    id: prefix + s.key,
    name: s.name,
    color: s.color,
    sortOrder: (i + 1) * 10,
    allowCustom: !!s.allowCustom,
    isActive: true,
    parts: (s.parts ?? []).map((p, j) => ({
      id: prefix + p.key,
      instrumentId: prefix + s.key,
      name: p.name,
      color: p.color ?? null,
      sortOrder: j + 1,
      isActive: true,
    })),
  }));
}

export const PALETTE = [
  '#2563eb', '#0891b2', '#7c3aed', '#c2410c', '#92400e', '#16a34a', '#0d9488', '#65a30d',
  '#ca8a04', '#dc2626', '#be123c', '#9f1239', '#475569', '#1f2937', '#db2777', '#4f46e5',
];
