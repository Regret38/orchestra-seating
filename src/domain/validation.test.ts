import { describe, expect, it } from 'vitest';
import { buildDefaultInstruments } from './defaults';
import { indexCatalog, resolveItemLabel } from './labels';
import { addItem, createEmptyLayoutData, makeItem, setSpares, updateItem } from './layoutOps';
import { buildExportFile, parseImportFile, remapToCatalog, validateLayoutData } from './validation';
import type { LayoutData } from './types';

function sample(): LayoutData {
  let d = createEmptyLayoutData();
  d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn2', labelSnapshot: { instrument: '바이올린', part: '제2바이올린' } }, 412, 233, 37.5));
  d = addItem(d, makeItem({ kind: 'bench', instrumentId: 'demo-perc', partId: null, labelSnapshot: { instrument: '타악기' } }, 900, 120, 270));
  d = updateItem(d, d.items[1].id, { benchLength: 333 });
  d = addItem(d, makeItem({ kind: 'chair_only', instrumentId: 'demo-other', partId: null, customLabel: '하프' }, -40, 1050, 359));
  d = addItem(d, makeItem({ kind: 'stand_only', instrumentId: null, partId: null }, 800, 890, 180));
  return setSpares(d, { stands: 2, chairs: 1, benches: 0 });
}

describe('JSON 내보내기 / 가져오기', () => {
  it('내보낸 파일을 다시 가져오면 위치·방향·악기·파트·장의자 길이·예비 수량이 그대로 복원된다', () => {
    const data = sample();
    const file = buildExportFile({ name: '11월 정기연주회', kind: 'event', eventDate: '2026-11-21', data });
    const text = JSON.stringify(file);
    const res = parseImportFile(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe('11월 정기연주회');
    expect(res.value.kind).toBe('event');
    expect(res.value.eventDate).toBe('2026-11-21');
    expect(res.value.data).toEqual(data);
  });

  it('BOM 이 붙은 파일도 읽는다', () => {
    const file = buildExportFile({ name: 'a', kind: 'template', eventDate: null, data: sample() });
    expect(parseImportFile('\uFEFF' + JSON.stringify(file)).ok).toBe(true);
  });

  it.each([
    ['JSON 이 아닌 파일', 'hello', /JSON 형식이 아닙니다/],
    ['다른 프로그램의 JSON', JSON.stringify({ foo: 1 }), /이 프로그램에서 내보낸 배치 파일이 아닙니다/],
    ['지원하지 않는 버전', JSON.stringify({ format: 'orchestra-seating-layout', formatVersion: 99 }), /지원하지 않는 파일 버전/],
  ])('%s → 이해하기 쉬운 오류', (_label, text, re) => {
    const res = parseImportFile(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join('\n')).toMatch(re);
  });

  it('값이 잘못된 세트는 몇 번째 세트의 어떤 값이 문제인지 알려 준다', () => {
    const file = buildExportFile({ name: 'x', kind: 'event', eventDate: '2026-02-30', data: sample() }) as unknown as {
      layout: { data: { items: Record<string, unknown>[] } };
    };
    file.layout.data.items[1].kind = 'sofa';
    file.layout.data.items[2].x = 'left';
    file.layout.data.items[3].benchLength = 5;
    const res = parseImportFile(JSON.stringify(file));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const msg = res.errors.join('\n');
    expect(msg).toMatch(/날짜는 YYYY-MM-DD/);
    expect(msg).toMatch(/2번째 세트의 종류 "sofa"/);
    expect(msg).toMatch(/3번째 세트의 위치\(x\)/);
    expect(msg).toMatch(/4번째 세트의 장의자 길이/);
  });

  it('세트 ID 중복과 이름 누락을 잡아낸다', () => {
    const data = sample();
    data.items[1].id = data.items[0].id;
    const res = parseImportFile(JSON.stringify(buildExportFile({ name: '  ', kind: 'event', eventDate: null, data })));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join('\n')).toMatch(/배치 이름이 없습니다/);
      expect(res.errors.join('\n')).toMatch(/ID가 중복/);
    }
  });

  it('너무 큰 파일은 거부한다', () => {
    const res = parseImportFile(' '.repeat(2 * 1024 * 1024 + 1));
    expect(res.ok).toBe(false);
  });

  it('회전값은 0~360 으로 정규화하고 누락된 선택 필드는 기본값으로 채운다', () => {
    const res = validateLayoutData({ items: [{ id: 'a', kind: 'stand_only', x: 1, y: 2, rotation: -90 }] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.items[0]).toEqual({ id: 'a', kind: 'stand_only', x: 1, y: 2, rotation: 270, instrumentId: null, partId: null });
      expect(res.value.spares).toEqual({ stands: 0, chairs: 0, benches: 0 });
      expect(res.value.stage.width).toBeGreaterThan(0);
    }
  });
});

describe('다른 팀에서 가져온 배치의 악기 연결', () => {
  it('ID 가 없으면 이름 사본으로 현재 팀 악기·파트에 다시 연결한다', () => {
    const otherTeam = indexCatalog(buildDefaultInstruments('other-'));
    const data = remapToCatalog(sample(), otherTeam);
    expect(data.items[0].instrumentId).toBe('other-violin');
    expect(data.items[0].partId).toBe('other-vn2');
    expect(resolveItemLabel(data.items[0], otherTeam).display).toBe('제2바이올린');
    expect(data.items[1].instrumentId).toBe('other-perc');
  });

  it('연결할 악기가 없어도 이름 사본으로 표시한다', () => {
    const empty = indexCatalog([]);
    const label = resolveItemLabel(sample().items[0], empty);
    expect(label.display).toBe('제2바이올린');
  });
});
