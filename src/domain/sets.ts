import type { SetKind, StageItem } from './types';

export interface ItemCounts {
  stands: number;
  chairs: number;
  benches: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SetDefinition {
  kind: SetKind;
  label: string;
  shortLabel: string;
  counts: ItemCounts;
}

/** 세트 구성표 (요구사항 3장) */
export const SET_DEFINITIONS: Record<SetKind, SetDefinition> = {
  stand_2chairs: {
    kind: 'stand_2chairs',
    label: '보면대 + 의자 2개',
    shortLabel: '보면대+의자2',
    counts: { stands: 1, chairs: 2, benches: 0 },
  },
  stand_1chair: {
    kind: 'stand_1chair',
    label: '보면대 + 의자 1개',
    shortLabel: '보면대+의자1',
    counts: { stands: 1, chairs: 1, benches: 0 },
  },
  stand_only: {
    kind: 'stand_only',
    label: '보면대만',
    shortLabel: '보면대만',
    counts: { stands: 1, chairs: 0, benches: 0 },
  },
  chair_only: {
    kind: 'chair_only',
    label: '의자만',
    shortLabel: '의자만',
    counts: { stands: 0, chairs: 1, benches: 0 },
  },
  bench: {
    kind: 'bench',
    label: '장의자',
    shortLabel: '장의자',
    counts: { stands: 0, chairs: 0, benches: 1 },
  },
};

// ---- 그림 치수(논리 단위). 축척 도면이 아닌 안내도 기준 ----
export const CHAIR_SIZE = 44;
export const STAND_WIDTH = 52;
export const STAND_DEPTH = 10;
export const BENCH_DEPTH = 44;
export const BENCH_DEFAULT_LENGTH = 150;
export const BENCH_MIN_LENGTH = 70;
export const BENCH_MAX_LENGTH = 600;

export interface SetGeometry {
  /** 세트 중심 기준 로컬 좌표의 의자 사각형 (y+ = 무대 앞) */
  chairs: Rect[];
  /** 보면대 막대 */
  stands: Rect[];
  bench: Rect | null;
  /** 회전 전 외곽 크기 */
  footprint: { w: number; h: number };
}

function chairAt(cx: number, cy: number): Rect {
  return { x: cx - CHAIR_SIZE / 2, y: cy - CHAIR_SIZE / 2, w: CHAIR_SIZE, h: CHAIR_SIZE };
}
function standAt(cx: number, cy: number): Rect {
  return { x: cx - STAND_WIDTH / 2, y: cy - STAND_DEPTH / 2, w: STAND_WIDTH, h: STAND_DEPTH };
}

export function clampBenchLength(len: number | undefined): number {
  if (typeof len !== 'number' || !Number.isFinite(len)) return BENCH_DEFAULT_LENGTH;
  return Math.min(BENCH_MAX_LENGTH, Math.max(BENCH_MIN_LENGTH, Math.round(len)));
}

export function getSetGeometry(kind: SetKind, benchLength?: number): SetGeometry {
  switch (kind) {
    case 'stand_2chairs':
      return {
        chairs: [chairAt(-26, -16), chairAt(26, -16)],
        stands: [standAt(0, 30)],
        bench: null,
        footprint: { w: 100, h: 80 },
      };
    case 'stand_1chair':
      return {
        chairs: [chairAt(0, -16)],
        stands: [standAt(0, 30)],
        bench: null,
        footprint: { w: 56, h: 80 },
      };
    case 'stand_only':
      return { chairs: [], stands: [standAt(0, 0)], bench: null, footprint: { w: 56, h: 32 } };
    case 'chair_only':
      return { chairs: [chairAt(0, 0)], stands: [], bench: null, footprint: { w: 48, h: 48 } };
    case 'bench': {
      const len = clampBenchLength(benchLength);
      return {
        chairs: [],
        stands: [],
        bench: { x: -len / 2, y: -BENCH_DEPTH / 2, w: len, h: BENCH_DEPTH },
        footprint: { w: len + 4, h: BENCH_DEPTH + 4 },
      };
    }
  }
}

/** 회전을 반영한 축 정렬 외곽 상자 (논리 좌표) */
export function itemBounds(item: Pick<StageItem, 'kind' | 'x' | 'y' | 'rotation' | 'benchLength'>): Rect {
  const { w, h } = getSetGeometry(item.kind, item.benchLength).footprint;
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: item.x - bw / 2, y: item.y - bh / 2, w: bw, h: bh };
}

export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let r = deg % 360;
  if (r < 0) r += 360;
  // 부동소수 오차 정리 (+ -0 제거)
  r = Math.round(r * 100) / 100;
  return r === 360 || r === 0 ? 0 : r;
}
