import { getSetGeometry, itemBounds, type Rect } from './sets';
import type { SetKind, StageItem, StageSize } from './types';

function intersectArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

/**
 * 새 세트를 놓을 위치를 찾는다.
 *  1) 현재 보이는 무대 영역의 가운데에서 시작해
 *  2) 나선형으로 주변 칸을 살피며 기존 세트와 겹치지 않는 첫 자리를 고른다.
 *  3) 빈 자리가 없으면 조금씩 비껴 놓아 완전히 겹쳐 숨지 않게 한다.
 */
export function findSpawnPosition(
  items: StageItem[],
  kind: SetKind,
  visible: Rect,
  stage: StageSize,
  benchLength?: number,
): { x: number; y: number } {
  const { w, h } = getSetGeometry(kind, benchLength).footprint;

  // 보이는 영역과 무대(약간 여유)의 교집합 안에 놓는다
  const area: Rect = (() => {
    const sx1 = -100;
    const sy1 = -100;
    const sx2 = stage.width + 100;
    const sy2 = stage.height + 100;
    const x1 = Math.max(visible.x, sx1);
    const y1 = Math.max(visible.y, sy1);
    const x2 = Math.min(visible.x + visible.w, sx2);
    const y2 = Math.min(visible.y + visible.h, sy2);
    if (x2 - x1 < w || y2 - y1 < h) return visible; // 무대 밖을 보고 있으면 보이는 영역 기준
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  })();

  const minX = area.x + w / 2 + 4;
  const maxX = area.x + area.w - w / 2 - 4;
  const minY = area.y + h / 2 + 4;
  const maxY = area.y + area.h - h / 2 - 4;
  const cx = clamp(area.x + area.w / 2, minX, maxX);
  const cy = clamp(area.y + area.h / 2, minY, maxY);

  const existing = items.map(itemBounds);
  const myArea = w * h;
  const free = (x: number, y: number) => {
    const r: Rect = { x: x - w / 2, y: y - h / 2, w, h };
    return existing.every((e) => intersectArea(r, e) < myArea * 0.08);
  };

  const stepX = w + 12;
  const stepY = h + 12;
  for (let ring = 0; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = cx + dx * stepX;
        const y = cy + dy * stepY;
        if (x < minX - 0.5 || x > maxX + 0.5 || y < minY - 0.5 || y > maxY + 0.5) continue;
        if (free(x, y)) return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }

  // 빈 자리가 없을 때: 가운데 근처에 이미 몇 개가 있는지 세어 계단식으로 비껴 놓는다
  const near = items.filter((it) => Math.abs(it.x - cx) < 200 && Math.abs(it.y - cy) < 200).length;
  const step = 22;
  const k = near % 8;
  return { x: Math.round(clamp(cx + k * step, minX, maxX)), y: Math.round(clamp(cy + k * step, minY, maxY)) };
}
