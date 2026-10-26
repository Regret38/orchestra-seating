import { BENCH_MAX_LENGTH, BENCH_MIN_LENGTH, SET_DEFINITIONS, normalizeRotation } from './sets';
import { DEFAULT_STAGE, emptySpares } from './layoutOps';
import type { CatalogIndex } from './labels';
import { SET_KINDS, type LayoutData, type LayoutKind, type SetKind, type StageItem } from './types';

export const EXPORT_FORMAT = 'orchestra-seating-layout';
export const EXPORT_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_ITEMS = 2000;
const COORD_LIMIT = 20000;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  layout: {
    name: string;
    kind: LayoutKind;
    eventDate: string | null;
    data: LayoutData;
  };
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function kindList(): string {
  return SET_KINDS.map((k) => `${k}(${SET_DEFINITIONS[k].label})`).join(', ');
}

/** layouts.data(JSON) 검증 + 정규화 */
export function validateLayoutData(raw: unknown, where = 'data'): ValidationResult<LayoutData> {
  const errors: string[] = [];
  const push = (msg: string) => {
    if (errors.length < 12) errors.push(msg);
  };

  if (!isObj(raw)) return { ok: false, errors: [`${where}: 배치 데이터가 객체 형식이 아닙니다.`] };

  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    push(`${where}.schemaVersion: 지원하지 않는 데이터 버전입니다(${String(raw.schemaVersion)}). 이 프로그램은 버전 1을 지원합니다.`);
  }

  // 무대 크기
  let stage = { ...DEFAULT_STAGE };
  if (raw.stage !== undefined) {
    if (!isObj(raw.stage) || !isNum(raw.stage.width) || !isNum(raw.stage.height)) {
      push(`${where}.stage: 무대 크기(width, height)는 숫자여야 합니다.`);
    } else if (raw.stage.width < 200 || raw.stage.width > 10000 || raw.stage.height < 200 || raw.stage.height > 10000) {
      push(`${where}.stage: 무대 크기가 허용 범위(200~10000)를 벗어났습니다.`);
    } else {
      stage = { width: raw.stage.width, height: raw.stage.height };
    }
  }

  // 예비 수량
  const spares = emptySpares();
  if (raw.spares !== undefined) {
    if (!isObj(raw.spares)) push(`${where}.spares: 예비 수량 형식이 올바르지 않습니다.`);
    else {
      for (const key of ['stands', 'chairs', 'benches'] as const) {
        const v = raw.spares[key];
        if (v === undefined) continue;
        if (!isNum(v) || v < 0 || v > 9999 || !Number.isInteger(v)) {
          push(`${where}.spares.${key}: 예비 수량은 0~9999 사이의 정수여야 합니다.`);
        } else spares[key] = v;
      }
    }
  }

  // 세트 목록
  const items: StageItem[] = [];
  if (!Array.isArray(raw.items)) {
    push(`${where}.items: 세트 목록(items)이 배열이 아닙니다.`);
  } else if (raw.items.length > MAX_ITEMS) {
    push(`${where}.items: 세트가 너무 많습니다(${raw.items.length}개, 최대 ${MAX_ITEMS}개).`);
  } else {
    const ids = new Set<string>();
    raw.items.forEach((it, i) => {
      const p = `${where}.items[${i}]`;
      const n = i + 1;
      if (!isObj(it)) {
        push(`${p}: ${n}번째 세트가 객체 형식이 아닙니다.`);
        return;
      }
      const before = errors.length;
      if (typeof it.id !== 'string' || it.id.length < 1 || it.id.length > 100) push(`${p}.id: ${n}번째 세트의 ID가 없습니다.`);
      else if (ids.has(it.id)) push(`${p}.id: ${n}번째 세트의 ID가 중복됩니다(${it.id}).`);
      if (typeof it.kind !== 'string' || !(SET_KINDS as readonly string[]).includes(it.kind)) {
        push(`${p}.kind: ${n}번째 세트의 종류 "${String(it.kind)}"를 알 수 없습니다. 가능한 값: ${kindList()}`);
      }
      for (const k of ['x', 'y'] as const) {
        if (!isNum(it[k]) || Math.abs(it[k] as number) > COORD_LIMIT) push(`${p}.${k}: ${n}번째 세트의 위치(${k})는 ±${COORD_LIMIT} 이내의 숫자여야 합니다.`);
      }
      if (it.rotation !== undefined && !isNum(it.rotation)) push(`${p}.rotation: ${n}번째 세트의 회전값은 숫자여야 합니다.`);
      if (it.benchLength !== undefined && (!isNum(it.benchLength) || it.benchLength < BENCH_MIN_LENGTH || it.benchLength > BENCH_MAX_LENGTH)) {
        push(`${p}.benchLength: ${n}번째 세트의 장의자 길이는 ${BENCH_MIN_LENGTH}~${BENCH_MAX_LENGTH} 사이의 숫자여야 합니다.`);
      }
      for (const k of ['instrumentId', 'partId'] as const) {
        const v = it[k];
        if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 100)) push(`${p}.${k}: ${n}번째 세트의 ${k} 형식이 올바르지 않습니다.`);
      }
      if (it.customLabel !== undefined && (typeof it.customLabel !== 'string' || it.customLabel.length > 40)) {
        push(`${p}.customLabel: ${n}번째 세트의 직접 입력 이름은 40자 이하 문자여야 합니다.`);
      }
      let snapshot: StageItem['labelSnapshot'];
      if (it.labelSnapshot !== undefined) {
        const s = it.labelSnapshot;
        if (!isObj(s) || (s.instrument !== undefined && typeof s.instrument !== 'string') || (s.part !== undefined && typeof s.part !== 'string')) {
          push(`${p}.labelSnapshot: ${n}번째 세트의 이름 정보 형식이 올바르지 않습니다.`);
        } else {
          snapshot = {
            ...(typeof s.instrument === 'string' ? { instrument: s.instrument.slice(0, 40) } : {}),
            ...(typeof s.part === 'string' ? { part: s.part.slice(0, 40) } : {}),
          };
        }
      }
      if (errors.length !== before) return;

      ids.add(it.id as string);
      const instrumentId = typeof it.instrumentId === 'string' ? it.instrumentId : null;
      const item: StageItem = {
        id: it.id as string,
        kind: it.kind as SetKind,
        x: it.x as number,
        y: it.y as number,
        rotation: normalizeRotation(isNum(it.rotation) ? it.rotation : 0),
        instrumentId,
        partId: instrumentId && typeof it.partId === 'string' ? it.partId : null,
      };
      if (item.kind === 'bench') item.benchLength = isNum(it.benchLength) ? it.benchLength : 150;
      if (typeof it.customLabel === 'string' && it.customLabel.trim()) item.customLabel = it.customLabel.trim();
      if (snapshot && (snapshot.instrument || snapshot.part)) item.labelSnapshot = snapshot;
      items.push(item);
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { schemaVersion: 1, stage, items, spares } };
}

export function buildExportFile(layout: ExportFile['layout'], now = new Date()): ExportFile {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    layout: structuredClone(layout),
  };
}

/** 가져올 JSON 텍스트를 검증한다. 사용자에게 보여 줄 한국어 오류 목록을 돌려준다. */
export function parseImportFile(text: string): ValidationResult<ExportFile['layout']> {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, errors: ['파일이 너무 큽니다(최대 2MB). 이 프로그램에서 내보낸 배치 파일인지 확인하세요.'] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, errors: ['JSON 형식이 아닙니다. 파일이 손상되었거나 다른 종류의 파일입니다.'] };
  }
  if (!isObj(raw)) return { ok: false, errors: ['배치 파일 형식이 아닙니다.'] };
  if (raw.format !== EXPORT_FORMAT) {
    return { ok: false, errors: ['이 프로그램에서 내보낸 배치 파일이 아닙니다(format 값이 다릅니다).'] };
  }
  if (raw.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { ok: false, errors: [`지원하지 않는 파일 버전입니다(${String(raw.formatVersion)}).`] };
  }
  const l = raw.layout;
  if (!isObj(l)) return { ok: false, errors: ['layout 항목이 없습니다.'] };

  const errors: string[] = [];
  const name = typeof l.name === 'string' ? l.name.trim() : '';
  if (!name) errors.push('layout.name: 배치 이름이 없습니다.');
  else if (name.length > 100) errors.push('layout.name: 배치 이름은 100자 이하여야 합니다.');
  const kind = l.kind === 'template' || l.kind === 'event' ? l.kind : null;
  if (!kind) errors.push('layout.kind: 배치 종류는 template(템플릿) 또는 event(일정)여야 합니다.');
  let eventDate: string | null = null;
  if (l.eventDate !== undefined && l.eventDate !== null) {
    if (typeof l.eventDate !== 'string' || !isValidDateString(l.eventDate)) errors.push('layout.eventDate: 날짜는 YYYY-MM-DD 형식이어야 합니다.');
    else eventDate = l.eventDate;
  }
  const data = validateLayoutData(l.data, 'layout.data');
  if (!data.ok) errors.push(...data.errors);
  if (errors.length || !data.ok || !kind) return { ok: false, errors: errors.slice(0, 12) };
  return { ok: true, value: { name, kind, eventDate, data: data.value } };
}

/**
 * 다른 팀/삭제된 악기 ID 를 현재 팀의 악기·파트에 이름으로 다시 연결한다.
 * 찾지 못하면 이름 사본(labelSnapshot)을 유지해 표시 이름은 그대로 보인다.
 */
export function remapToCatalog(data: LayoutData, catalog: CatalogIndex): LayoutData {
  const byName = new Map<string, string>();
  for (const inst of catalog.instruments.values()) byName.set(inst.name, inst.id);
  return {
    ...data,
    items: data.items.map((it) => {
      if (!it.instrumentId || catalog.instruments.has(it.instrumentId)) {
        if (it.instrumentId && it.partId && !catalog.parts.has(it.partId)) {
          const inst = catalog.instruments.get(it.instrumentId)!;
          const p = inst.parts.find((pp) => pp.name === it.labelSnapshot?.part);
          return p ? { ...it, partId: p.id } : it;
        }
        return it;
      }
      const instName = it.labelSnapshot?.instrument;
      const instId = instName ? byName.get(instName) : undefined;
      if (!instId) return it;
      const inst = catalog.instruments.get(instId)!;
      const part = it.labelSnapshot?.part ? inst.parts.find((p) => p.name === it.labelSnapshot?.part) : undefined;
      return { ...it, instrumentId: instId, partId: part ? part.id : it.labelSnapshot?.part ? it.partId : null };
    }),
  };
}
