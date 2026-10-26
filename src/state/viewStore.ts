import { create } from 'zustand';
import { contentBounds, fitRect, visibleLogicalRect, zoomAt, type Size, type View } from '../domain/viewport';
import type { Rect } from '../domain/sets';
import type { StageItem, StageSize } from '../domain/types';

interface ViewState {
  view: View;
  size: Size;
  setView(v: View): void;
  setSize(s: Size): void;
  zoomBy(factor: number): void;
  fitTo(items: StageItem[], stage: StageSize): void;
  visibleRect(): Rect;
}

/** 무대 화면의 확대·이동 상태 (저장 데이터와 무관) */
export const useView = create<ViewState>()((set, get) => ({
  view: { scale: 0.5, x: 0, y: 0 },
  size: { width: 800, height: 600 },
  setView: (view) => set({ view }),
  setSize: (size) => set({ size }),
  zoomBy(factor) {
    const { view, size } = get();
    set({ view: zoomAt(view, { x: size.width / 2, y: size.height / 2 }, factor) });
  },
  fitTo(items, stage) {
    const { size } = get();
    set({ view: fitRect(contentBounds(items, stage), size, Math.min(32, size.width * 0.04)) });
  },
  visibleRect() {
    const { view, size } = get();
    return visibleLogicalRect(view, size);
  },
}));
