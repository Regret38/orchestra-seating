import { newId } from './id';
import { BENCH_DEFAULT_LENGTH, clampBenchLength, normalizeRotation } from './sets';
import type { LayoutData, SetKind, Spares, StageItem, StageSize } from './types';

/** 무대 논리 크기 (단위: 안내도 단위, 실제 cm 아님) */
export const DEFAULT_STAGE: StageSize = { width: 1600, height: 1000 };
/** 무대 앞(관객 쪽) 가장자리 띠 높이 */
export const FRONT_BAND = 70;

export function emptySpares(): Spares {
  return { stands: 0, chairs: 0, benches: 0 };
}

export function createEmptyLayoutData(): LayoutData {
  return { schemaVersion: 1, stage: { ...DEFAULT_STAGE }, items: [], spares: emptySpares() };
}

/** 지휘대 위치(무대 앞 중앙) */
export function podiumPoint(stage: StageSize): { x: number; y: number } {
  return { x: stage.width / 2, y: stage.height - FRONT_BAND - 40 };
}

/**
 * (x, y) 에 놓인 세트의 앞(보면대 쪽)이 target 을 향하게 하는 회전각(도).
 * 회전 0 일 때 세트 앞은 화면 아래(+y, 관객 방향)이고 각도는 시계 방향이 +.
 */
export function faceAngle(from: { x: number; y: number }, target: { x: number; y: number }): number {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0;
  return normalizeRotation(Math.round((Math.atan2(-dx, dy) * 180) / Math.PI));
}

/**
 * 템플릿 → 일정, 일정 → 일정 복사.
 * 깊은 복사 + 세트 ID 재발급으로 원본과 완전히 분리한다.
 */
export function cloneLayoutData(data: LayoutData): LayoutData {
  const copy: LayoutData = structuredClone(data);
  copy.items = copy.items.map((it) => ({ ...it, id: newId() }));
  return copy;
}

export interface NewItemInput {
  kind: SetKind;
  instrumentId: string | null;
  partId: string | null;
  customLabel?: string;
  labelSnapshot?: StageItem['labelSnapshot'];
}

export function makeItem(input: NewItemInput, x: number, y: number, rotation = 0): StageItem {
  const item: StageItem = {
    id: newId(),
    kind: input.kind,
    x: Math.round(x),
    y: Math.round(y),
    rotation: normalizeRotation(rotation),
    instrumentId: input.instrumentId,
    partId: input.instrumentId ? input.partId : null,
  };
  if (input.kind === 'bench') item.benchLength = BENCH_DEFAULT_LENGTH;
  if (input.customLabel?.trim()) item.customLabel = input.customLabel.trim();
  if (input.labelSnapshot) item.labelSnapshot = input.labelSnapshot;
  return item;
}

export function addItem(data: LayoutData, item: StageItem): LayoutData {
  return { ...data, items: [...data.items, item] };
}

export function updateItem(data: LayoutData, id: string, patch: Partial<Omit<StageItem, 'id'>>): LayoutData {
  let changed = false;
  const items = data.items.map((it) => {
    if (it.id !== id) return it;
    changed = true;
    const next: StageItem = { ...it, ...patch };
    if (patch.rotation !== undefined) next.rotation = normalizeRotation(patch.rotation);
    if (next.kind === 'bench') next.benchLength = clampBenchLength(next.benchLength);
    else delete next.benchLength;
    if (!next.instrumentId) {
      next.partId = null;
      delete next.labelSnapshot;
    }
    return next;
  });
  return changed ? { ...data, items } : data;
}

export function removeItem(data: LayoutData, id: string): LayoutData {
  const items = data.items.filter((it) => it.id !== id);
  return items.length === data.items.length ? data : { ...data, items };
}

/** 복제: 같은 구성으로 약간 옆에 놓는다 */
export function duplicateItem(data: LayoutData, id: string, offset = 30): { data: LayoutData; newId: string | null } {
  const src = data.items.find((it) => it.id === id);
  if (!src) return { data, newId: null };
  const copy: StageItem = { ...structuredClone(src), id: newId(), x: src.x + offset, y: src.y + offset };
  return { data: { ...data, items: [...data.items, copy] }, newId: copy.id };
}

export function changeItemKind(data: LayoutData, id: string, kind: SetKind): LayoutData {
  return updateItem(data, id, { kind });
}

export function setSpares(data: LayoutData, spares: Partial<Spares>): LayoutData {
  const clean = (n: number | undefined, prev: number) =>
    n === undefined ? prev : Number.isFinite(n) && n > 0 ? Math.min(9999, Math.floor(n)) : 0;
  return {
    ...data,
    spares: {
      stands: clean(spares.stands, data.spares.stands),
      chairs: clean(spares.chairs, data.spares.chairs),
      benches: clean(spares.benches, data.spares.benches),
    },
  };
}

/** 두 배치 데이터가 같은 내용인지 (저장하지 않은 변경 판단용) */
export function sameLayoutData(a: LayoutData, b: LayoutData): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
