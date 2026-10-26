import { BENCH_DEFAULT_LENGTH } from '../domain/sets';
import { DEFAULT_STAGE, createEmptyLayoutData, faceAngle, podiumPoint } from '../domain/layoutOps';
import { newId } from '../domain/id';
import type { LayoutData, SetKind, StageItem } from '../domain/types';

/** 데모 모드에서 보여 줄 가상의 기본 배치(실제 단체 정보 아님) */
export function buildDemoTemplateData(prefix = 'demo-'): LayoutData {
  const data = createEmptyLayoutData();
  const podium = podiumPoint(DEFAULT_STAGE);
  const items: StageItem[] = [];

  const at = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: Math.round(podium.x + r * Math.sin(rad)), y: Math.round(podium.y - r * Math.cos(rad)) };
  };
  const put = (kind: SetKind, r: number, degs: number[], inst: string | null, part: string | null = null) => {
    for (const d of degs) {
      const p = at(r, d);
      const item: StageItem = {
        id: newId(),
        kind,
        x: p.x,
        y: p.y,
        rotation: faceAngle(p, podium),
        instrumentId: inst ? prefix + inst : null,
        partId: part ? prefix + part : null,
      };
      if (kind === 'bench') item.benchLength = BENCH_DEFAULT_LENGTH;
      items.push(item);
    }
  };

  put('stand_2chairs', 200, [-72, -52, -32], 'violin', 'vn1');
  put('stand_2chairs', 200, [32, 52, 72], 'cello');
  put('stand_2chairs', 320, [-72, -56, -40, -24], 'violin', 'vn2');
  put('stand_2chairs', 320, [24, 40, 56, 72], 'viola');
  put('stand_1chair', 450, [-22], 'flute', 'fl1');
  put('stand_1chair', 450, [-13], 'flute', 'fl2');
  put('stand_1chair', 450, [-4], 'oboe');
  put('stand_1chair', 450, [5], 'clarinet', 'cl1');
  put('stand_1chair', 450, [14], 'clarinet', 'cl2');
  put('stand_1chair', 450, [23], 'bassoon');
  put('stand_1chair', 470, [58, 66], 'bass');
  put('stand_1chair', 560, [-26, -19, -12], 'horn');
  put('stand_1chair', 560, [-2, 5], 'trumpet');
  put('stand_1chair', 560, [15, 22], 'trombone');
  put('stand_1chair', 560, [29], 'tuba');
  put('stand_only', 680, [-6, 6], 'perc');
  put('bench', 680, [-20], 'perc');

  // 지휘자 보면대: 단원 쪽(무대 뒤)을 향함
  items.push({
    id: newId(),
    kind: 'stand_only',
    x: podium.x,
    y: podium.y,
    rotation: 180,
    instrumentId: null,
    partId: null,
  });

  data.items = items;
  data.spares = { stands: 2, chairs: 2, benches: 0 };
  return data;
}
