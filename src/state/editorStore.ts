import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { sameLayoutData, createEmptyLayoutData } from '../domain/layoutOps';
import type { LayoutData, LayoutKind, LayoutRecord, SetKind } from '../domain/types';

export interface LayoutMeta {
  id: string;
  teamId: string;
  kind: LayoutKind;
  name: string;
  eventDate: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  createdBy: string | null;
  sourceLayoutId: string | null;
}

type MetaFields = Pick<LayoutMeta, 'kind' | 'name' | 'eventDate'>;

export type SaveStatus = 'idle' | 'saving' | 'error' | 'conflict';

const HISTORY_LIMIT = 200;

export interface EditorState {
  meta: LayoutMeta | null;
  data: LayoutData;
  /** 마지막으로 서버(또는 데모 메모리)와 일치했던 내용 */
  baseline: { data: LayoutData; meta: MetaFields } | null;
  past: LayoutData[];
  future: LayoutData[];
  selectedId: string | null;
  gestureStart: LayoutData | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  conflict: LayoutRecord | null;
  lastSavedAt: string | null;

  load(record: LayoutRecord): void;
  reset(): void;
  setMeta(patch: Partial<MetaFields>): void;
  /** 실행 취소 기록을 남기는 변경 */
  commit(fn: (d: LayoutData) => LayoutData, select?: string | null): void;
  /** 드래그·회전 같은 연속 동작: 시작 → 임시 갱신 → 끝에서 한 번만 기록 */
  beginGesture(): void;
  updateTransient(fn: (d: LayoutData) => LayoutData): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;

  markSaving(): void;
  markSaved(record: LayoutRecord, sent: { data: LayoutData; meta: MetaFields }): void;
  markError(message: string): void;
  markConflict(latest: LayoutRecord): void;
  clearConflict(): void;
}

function metaFields(m: { kind: LayoutKind; name: string; eventDate: string | null }): MetaFields {
  return { kind: m.kind, name: m.name, eventDate: m.eventDate };
}

function recordToMeta(r: LayoutRecord): LayoutMeta {
  return {
    id: r.id,
    teamId: r.teamId,
    kind: r.kind,
    name: r.name,
    eventDate: r.eventDate,
    version: r.version,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    createdBy: r.createdBy,
    sourceLayoutId: r.sourceLayoutId,
  };
}

const initial = {
  meta: null,
  data: createEmptyLayoutData(),
  baseline: null,
  past: [],
  future: [],
  selectedId: null,
  gestureStart: null,
  saveStatus: 'idle' as SaveStatus,
  saveError: null,
  conflict: null,
  lastSavedAt: null,
};

export const useEditor = create<EditorState>()((set, get) => ({
  ...initial,

  load(record) {
    set({
      ...initial,
      meta: recordToMeta(record),
      data: record.data,
      baseline: { data: record.data, meta: metaFields(record) },
      lastSavedAt: record.updatedAt,
    });
  },
  reset() {
    set({ ...initial });
  },
  setMeta(patch) {
    const m = get().meta;
    if (!m) return;
    set({ meta: { ...m, ...patch } });
  },
  commit(fn, select) {
    const s = get();
    const next = fn(s.data);
    if (next === s.data) {
      if (select !== undefined) set({ selectedId: select });
      return;
    }
    set({
      data: next,
      past: [...s.past, s.data].slice(-HISTORY_LIMIT),
      future: [],
      ...(select !== undefined ? { selectedId: select } : {}),
    });
  },
  beginGesture() {
    set({ gestureStart: get().data });
  },
  updateTransient(fn) {
    set({ data: fn(get().data) });
  },
  endGesture() {
    const s = get();
    if (!s.gestureStart) return;
    if (s.gestureStart === s.data || sameLayoutData(s.gestureStart, s.data)) {
      set({ gestureStart: null, data: s.gestureStart });
      return;
    }
    set({ past: [...s.past, s.gestureStart].slice(-HISTORY_LIMIT), future: [], gestureStart: null });
  },
  undo() {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      data: prev,
      past: s.past.slice(0, -1),
      future: [s.data, ...s.future].slice(0, HISTORY_LIMIT),
      selectedId: prev.items.some((i) => i.id === s.selectedId) ? s.selectedId : null,
    });
  },
  redo() {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      data: next,
      past: [...s.past, s.data].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      selectedId: next.items.some((i) => i.id === s.selectedId) ? s.selectedId : null,
    });
  },
  select(id) {
    set({ selectedId: id });
  },

  markSaving() {
    set({ saveStatus: 'saving', saveError: null });
  },
  markSaved(record, sent) {
    const m = get().meta;
    if (!m) return;
    set({
      saveStatus: 'idle',
      saveError: null,
      conflict: null,
      lastSavedAt: record.updatedAt,
      baseline: { data: sent.data, meta: sent.meta },
      meta: { ...m, ...(m.name.trim() === sent.meta.name ? { name: sent.meta.name } : {}), version: record.version, updatedAt: record.updatedAt, updatedBy: record.updatedBy },
    });
  },
  markError(message) {
    set({ saveStatus: 'error', saveError: message });
  },
  markConflict(latest) {
    set({ saveStatus: 'conflict', conflict: latest, saveError: null });
  },
  clearConflict() {
    set({ saveStatus: 'idle', conflict: null });
  },
}));

/** 저장하지 않은 변경이 있는지 */
export function selectIsDirty(s: Pick<EditorState, 'meta' | 'data' | 'baseline'>): boolean {
  if (!s.meta || !s.baseline) return false;
  const b = s.baseline.meta;
  if (b.name !== s.meta.name || b.kind !== s.meta.kind || b.eventDate !== s.meta.eventDate) return true;
  return !sameLayoutData(s.baseline.data, s.data);
}

// ---------------------------------------------------------------------
// 사용자별 기본 선택값(브라우저에 기억): 같은 세트를 반복 추가할 때 이전 선택 유지
// ---------------------------------------------------------------------
export interface Prefs {
  addKind: SetKind;
  addInstrumentId: string | null;
  addPartId: string | null;
  addCustomLabel: string;
  showGrid: boolean;
  snap: boolean;
  set(patch: Partial<Omit<Prefs, 'set'>>): void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      addKind: 'stand_2chairs',
      addInstrumentId: null,
      addPartId: null,
      addCustomLabel: '',
      showGrid: true,
      snap: false,
      set: (patch) => set(patch),
    }),
    { name: 'orchestra-seating:prefs', version: 1 },
  ),
);
