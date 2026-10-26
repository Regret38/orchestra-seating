import { describe, expect, it } from 'vitest';
import { computeCounts } from './counting';
import { buildDefaultInstruments } from './defaults';
import { indexCatalog } from './labels';
import {
  addItem,
  changeItemKind,
  createEmptyLayoutData,
  duplicateItem,
  makeItem,
  removeItem,
  setSpares,
  updateItem,
} from './layoutOps';
import { SET_KINDS, type LayoutData, type SetKind } from './types';

const catalog = indexCatalog(buildDefaultInstruments());

function withKinds(kinds: SetKind[], instrumentId: string | null = null, partId: string | null = null): LayoutData {
  let d = createEmptyLayoutData();
  kinds.forEach((k, i) => {
    d = addItem(d, makeItem({ kind: k, instrumentId, partId }, 100 + i * 120, 300));
  });
  return d;
}

describe('수량 자동 집계', () => {
  it('5종 세트를 1개씩 추가하면 보면대 3, 일반 의자 4, 장의자 1', () => {
    const d = withKinds([...SET_KINDS]);
    const c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 3, chairs: 4, benches: 1 });
    expect(c.total).toEqual({ stands: 3, chairs: 4, benches: 1 });
    expect(c.bySetKind).toEqual({ stand_2chairs: 1, stand_1chair: 1, stand_only: 1, chair_only: 1, bench: 1 });
    expect(c.setCount).toBe(5);
  });

  it('빈 배치는 모두 0', () => {
    const d = createEmptyLayoutData();
    expect(computeCounts(d.items, d.spares, catalog).total).toEqual({ stands: 0, chairs: 0, benches: 0 });
  });

  it('복제하면 해당 세트 구성만큼 늘어난다', () => {
    let d = withKinds(['stand_2chairs']);
    d = duplicateItem(d, d.items[0].id).data;
    d = duplicateItem(d, d.items[0].id).data;
    const c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 3, chairs: 6, benches: 0 });
    expect(new Set(d.items.map((i) => i.id)).size).toBe(3);
  });

  it('삭제하면 해당 세트 구성만큼 줄어든다', () => {
    let d = withKinds([...SET_KINDS]);
    const bench = d.items.find((i) => i.kind === 'bench')!;
    d = removeItem(d, bench.id);
    const chairOnly = d.items.find((i) => i.kind === 'chair_only')!;
    d = removeItem(d, chairOnly.id);
    expect(computeCounts(d.items, d.spares, catalog).placed).toEqual({ stands: 3, chairs: 3, benches: 0 });
  });

  it('세트 종류를 바꾸면 즉시 새 구성으로 집계된다', () => {
    let d = withKinds(['stand_2chairs', 'stand_2chairs']);
    d = changeItemKind(d, d.items[0].id, 'bench');
    let c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 1, chairs: 2, benches: 1 });
    expect(d.items[0].benchLength).toBeGreaterThan(0);

    d = changeItemKind(d, d.items[0].id, 'stand_only');
    c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 2, chairs: 2, benches: 0 });
    expect(d.items[0].benchLength).toBeUndefined();
  });

  it('이동·회전·악기 변경·장의자 길이 변경은 물품 수량에 영향이 없다', () => {
    let d = withKinds([...SET_KINDS]);
    const before = computeCounts(d.items, d.spares, catalog);
    for (const it of d.items) {
      d = updateItem(d, it.id, { x: it.x + 333, y: it.y - 77, rotation: 135, instrumentId: 'demo-cello', partId: null });
    }
    const bench = d.items.find((i) => i.kind === 'bench')!;
    d = updateItem(d, bench.id, { benchLength: 500 });
    const after = computeCounts(d.items, d.spares, catalog);
    expect(after.placed).toEqual(before.placed);
    expect(after.bySetKind).toEqual(before.bySetKind);
  });

  it('장의자는 길이와 관계없이 1개이며 일반 의자로 환산하지 않는다', () => {
    let d = withKinds(['bench']);
    d = updateItem(d, d.items[0].id, { benchLength: 600 });
    const c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 0, chairs: 0, benches: 1 });
  });

  it('예비 수량은 무대 객체를 만들지 않고 최종 준비 수량에만 더해진다', () => {
    let d = withKinds(Array(9).fill('stand_2chairs').concat(Array(9).fill('stand_1chair'), ['bench']) as SetKind[]);
    d = setSpares(d, { stands: 2, chairs: 2, benches: 0 });
    const c = computeCounts(d.items, d.spares, catalog);
    expect(c.placed).toEqual({ stands: 18, chairs: 27, benches: 1 });
    expect(c.spares).toEqual({ stands: 2, chairs: 2, benches: 0 });
    expect(c.total).toEqual({ stands: 20, chairs: 29, benches: 1 });
    expect(d.items).toHaveLength(19);
  });

  it('잘못된 예비 수량(음수·소수·NaN)은 0 또는 정수로 정리된다', () => {
    const d = setSpares(createEmptyLayoutData(), { stands: -3, chairs: 2.7, benches: Number.NaN });
    expect(d.spares).toEqual({ stands: 0, chairs: 2, benches: 0 });
  });

  it('악기·파트별로 물품 수량을 나눠 집계하고 미지정/공용도 구분한다', () => {
    let d = createEmptyLayoutData();
    d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn1' }, 0, 0));
    d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn1' }, 0, 0));
    d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn2' }, 0, 0));
    d = addItem(d, makeItem({ kind: 'stand_1chair', instrumentId: 'demo-viola', partId: null }, 0, 0));
    d = addItem(d, makeItem({ kind: 'stand_only', instrumentId: null, partId: null }, 0, 0));
    d = addItem(d, makeItem({ kind: 'chair_only', instrumentId: 'demo-other', partId: null, customLabel: '하프' }, 0, 0));
    const c = computeCounts(d.items, d.spares, catalog);
    const byLabel = Object.fromEntries(c.byGroup.map((g) => [g.label, { s: g.stands, c: g.chairs, b: g.benches, n: g.sets }]));
    expect(byLabel).toEqual({
      제1바이올린: { s: 2, c: 4, b: 0, n: 2 },
      제2바이올린: { s: 1, c: 2, b: 0, n: 1 },
      비올라: { s: 1, c: 1, b: 0, n: 1 },
      하프: { s: 0, c: 1, b: 0, n: 1 },
      '미지정/공용': { s: 1, c: 0, b: 0, n: 1 },
    });
    // 악기 정렬 순서, 미지정은 마지막
    expect(c.byGroup.map((g) => g.label)).toEqual(['제1바이올린', '제2바이올린', '비올라', '하프', '미지정/공용']);
  });

  it('악기를 미지정으로 바꾸면 파트도 함께 지워진다', () => {
    let d = createEmptyLayoutData();
    d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn1' }, 0, 0));
    d = updateItem(d, d.items[0].id, { instrumentId: null });
    expect(d.items[0].partId).toBeNull();
  });
});
