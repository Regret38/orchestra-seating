import type { Instrument, Part, StageItem } from './types';

export const UNASSIGNED_LABEL = '미지정/공용';
export const UNASSIGNED_COLOR = '#94a3b8';
export const MISSING_COLOR = '#a8a29e';

export interface CatalogIndex {
  instruments: Map<string, Instrument>;
  parts: Map<string, Part>;
}

export function indexCatalog(instruments: Instrument[]): CatalogIndex {
  const iMap = new Map<string, Instrument>();
  const pMap = new Map<string, Part>();
  for (const inst of instruments) {
    iMap.set(inst.id, inst);
    for (const p of inst.parts) pMap.set(p.id, p);
  }
  return { instruments: iMap, parts: pMap };
}

export interface ResolvedLabel {
  /** 집계 그룹 키 */
  key: string;
  /** 화면 표시 이름 (파트가 있으면 파트명, 없으면 악기명) */
  display: string;
  instrumentName: string;
  partName: string | null;
  color: string;
  /** 정렬용 */
  sortKey: [number, number, string];
}

export function resolveItemLabel(item: StageItem, catalog: CatalogIndex): ResolvedLabel {
  if (!item.instrumentId) {
    return {
      key: 'unassigned',
      display: UNASSIGNED_LABEL,
      instrumentName: UNASSIGNED_LABEL,
      partName: null,
      color: UNASSIGNED_COLOR,
      sortKey: [Number.MAX_SAFE_INTEGER, 0, ''],
    };
  }
  const inst = catalog.instruments.get(item.instrumentId);
  if (!inst) {
    const iName = item.customLabel?.trim() || item.labelSnapshot?.instrument || '(삭제된 악기)';
    const pName = item.labelSnapshot?.part ?? null;
    return {
      key: `missing:${iName}:${pName ?? ''}`,
      display: pName ?? iName,
      instrumentName: iName,
      partName: pName,
      color: MISSING_COLOR,
      sortKey: [Number.MAX_SAFE_INTEGER - 1, 0, iName + (pName ?? '')],
    };
  }

  if (inst.allowCustom) {
    const custom = item.customLabel?.trim();
    const name = custom || inst.name;
    return {
      key: `${inst.id}:custom:${custom ?? ''}`,
      display: name,
      instrumentName: name,
      partName: null,
      color: inst.color,
      sortKey: [inst.sortOrder, 0, name],
    };
  }

  const part = item.partId ? catalog.parts.get(item.partId) : undefined;
  if (item.partId && (!part || part.instrumentId !== inst.id)) {
    const pName = item.labelSnapshot?.part ?? '(삭제된 파트)';
    return {
      key: `${inst.id}:missing:${pName}`,
      display: pName,
      instrumentName: inst.name,
      partName: pName,
      color: inst.color,
      sortKey: [inst.sortOrder, Number.MAX_SAFE_INTEGER, pName],
    };
  }
  if (part) {
    return {
      key: `${inst.id}:${part.id}`,
      display: part.name,
      instrumentName: inst.name,
      partName: part.name,
      color: part.color || inst.color,
      sortKey: [inst.sortOrder, part.sortOrder, part.name],
    };
  }
  return {
    key: `${inst.id}:`,
    display: inst.name,
    instrumentName: inst.name,
    partName: null,
    color: inst.color,
    sortKey: [inst.sortOrder, -1, inst.name],
  };
}

/** 저장 시 이름 사본을 남겨 두어 악기가 삭제되거나 다른 팀으로 옮겨도 이름을 복원할 수 있게 한다. */
export function snapshotLabel(item: StageItem, catalog: CatalogIndex): StageItem['labelSnapshot'] {
  if (!item.instrumentId) return undefined;
  const inst = catalog.instruments.get(item.instrumentId);
  if (!inst) return item.labelSnapshot;
  const part = item.partId ? catalog.parts.get(item.partId) : undefined;
  return { instrument: inst.name, ...(part ? { part: part.name } : {}) };
}

/** 색상을 밝게 섞은 채움색 */
export function tint(hex: string, amount = 0.78): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#e2e8f0';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
