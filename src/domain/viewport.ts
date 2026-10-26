import { itemBounds, type Rect } from './sets';
import type { StageItem, StageSize } from './types';

/**
 * 화면 변환: 화면좌표 = 논리좌표 × scale + (x, y)
 * 배치 데이터는 논리 좌표만 저장하므로, 화면 크기가 달라도 배치 관계는 그대로다.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 6;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function screenToLogical(view: View, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

export function logicalToScreen(view: View, p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** 사각형이 화면 가운데에 꽉 차도록 맞춘다 */
export function fitRect(rect: Rect, size: Size, padding = 24): View {
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  const scale = clampScale(Math.min(availW / Math.max(1, rect.w), availH / Math.max(1, rect.h)));
  return {
    scale,
    x: size.width / 2 - (rect.x + rect.w / 2) * scale,
    y: size.height / 2 - (rect.y + rect.h / 2) * scale,
  };
}

/** 화면의 한 점을 고정한 채 확대·축소 */
export function zoomAt(view: View, screenPoint: { x: number; y: number }, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const logical = screenToLogical(view, screenPoint);
  return { scale, x: screenPoint.x - logical.x * scale, y: screenPoint.y - logical.y * scale };
}

export function visibleLogicalRect(view: View, size: Size): Rect {
  const tl = screenToLogical(view, { x: 0, y: 0 });
  return { x: tl.x, y: tl.y, w: size.width / view.scale, h: size.height / view.scale };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * '화면 맞추기' 대상 영역: 배치된 세트 전체(+여백).
 * 세트가 없으면 무대 전체.
 */
export function contentBounds(items: StageItem[], stage: StageSize, margin = 60): Rect {
  const u = unionRects(items.map(itemBounds));
  if (!u) return { x: -20, y: -20, w: stage.width + 40, h: stage.height + 40 };
  const minW = 360;
  const minH = 260;
  const w = Math.max(minW, u.w + margin * 2);
  const h = Math.max(minH, u.h + margin * 2);
  return { x: u.x + u.w / 2 - w / 2, y: u.y + u.h / 2 - h / 2, w, h };
}
