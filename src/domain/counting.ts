import { SET_DEFINITIONS, type ItemCounts } from './sets';
import { resolveItemLabel, type CatalogIndex } from './labels';
import { SET_KINDS, type SetKind, type Spares, type StageItem } from './types';

export interface GroupCount extends ItemCounts {
  key: string;
  label: string;
  instrumentName: string;
  color: string;
  sets: number;
}

export interface CountSummary {
  placed: ItemCounts;
  spares: ItemCounts;
  total: ItemCounts;
  bySetKind: Record<SetKind, number>;
  byGroup: GroupCount[];
  setCount: number;
}

export function emptyCounts(): ItemCounts {
  return { stands: 0, chairs: 0, benches: 0 };
}

function sanitizeSpare(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 무대에 실제 놓인 세트의 구성만으로 수량을 계산한다.
 * 위치·회전·장의자 길이·이름은 결과에 영향을 주지 않는다.
 * 예비 수량은 객체를 만들지 않고 최종 준비 수량에만 더한다.
 */
export function computeCounts(items: StageItem[], spares: Spares, catalog: CatalogIndex): CountSummary {
  const placed = emptyCounts();
  const bySetKind = Object.fromEntries(SET_KINDS.map((k) => [k, 0])) as Record<SetKind, number>;
  const groups = new Map<string, GroupCount & { sortKey: [number, number, string] }>();

  for (const item of items) {
    const def = SET_DEFINITIONS[item.kind];
    if (!def) continue;
    placed.stands += def.counts.stands;
    placed.chairs += def.counts.chairs;
    placed.benches += def.counts.benches;
    bySetKind[item.kind] += 1;

    const label = resolveItemLabel(item, catalog);
    let g = groups.get(label.key);
    if (!g) {
      g = {
        key: label.key,
        label: label.display,
        instrumentName: label.instrumentName,
        color: label.color,
        sets: 0,
        ...emptyCounts(),
        sortKey: label.sortKey,
      };
      groups.set(label.key, g);
    }
    g.sets += 1;
    g.stands += def.counts.stands;
    g.chairs += def.counts.chairs;
    g.benches += def.counts.benches;
  }

  const sp: ItemCounts = {
    stands: sanitizeSpare(spares.stands),
    chairs: sanitizeSpare(spares.chairs),
    benches: sanitizeSpare(spares.benches),
  };

  const byGroup = [...groups.values()]
    .sort((a, b) => {
      for (let i = 0; i < 2; i++) {
        const d = (a.sortKey[i] as number) - (b.sortKey[i] as number);
        if (d !== 0) return d;
      }
      return a.sortKey[2].localeCompare(b.sortKey[2], 'ko');
    })
    .map(({ sortKey: _sortKey, ...rest }) => rest);

  return {
    placed,
    spares: sp,
    total: {
      stands: placed.stands + sp.stands,
      chairs: placed.chairs + sp.chairs,
      benches: placed.benches + sp.benches,
    },
    bySetKind,
    byGroup,
    setCount: items.length,
  };
}
