import { describe, expect, it } from 'vitest';
import { addItem, cloneLayoutData, createEmptyLayoutData, faceAngle, makeItem, updateItem } from './layoutOps';
import { findSpawnPosition } from './placement';
import { itemBounds } from './sets';
import { contentBounds, fitRect, logicalToScreen, screenToLogical, visibleLogicalRect, zoomAt } from './viewport';
import type { StageItem } from './types';

describe('논리 좌표와 화면 좌표 분리', () => {
  const items: StageItem[] = [
    makeItem({ kind: 'stand_2chairs', instrumentId: null, partId: null }, 300, 400, 20),
    makeItem({ kind: 'stand_1chair', instrumentId: null, partId: null }, 900, 250, 0),
    makeItem({ kind: 'bench', instrumentId: null, partId: null }, 1200, 700, 90),
  ];
  const stage = { width: 1600, height: 1000 };

  it('노트북·휴대폰 화면에서 같은 배치를 맞추면 세트 사이의 상대 위치(비율·방향)가 같다', () => {
    const laptop = fitRect(contentBounds(items, stage), { width: 1280, height: 720 });
    const phone = fitRect(contentBounds(items, stage), { width: 390, height: 640 });

    const vec = (v: typeof laptop, a: StageItem, b: StageItem) => {
      const pa = logicalToScreen(v, a);
      const pb = logicalToScreen(v, b);
      return { x: pb.x - pa.x, y: pb.y - pa.y };
    };
    const l1 = vec(laptop, items[0], items[1]);
    const l2 = vec(laptop, items[0], items[2]);
    const p1 = vec(phone, items[0], items[1]);
    const p2 = vec(phone, items[0], items[2]);
    // 같은 배율로만 달라지고(균일 축척), 비율·각도는 동일
    const k = phone.scale / laptop.scale;
    expect(p1.x).toBeCloseTo(l1.x * k, 6);
    expect(p1.y).toBeCloseTo(l1.y * k, 6);
    expect(p2.x).toBeCloseTo(l2.x * k, 6);
    expect(p2.y).toBeCloseTo(l2.y * k, 6);
    expect(Math.atan2(p1.y, p1.x)).toBeCloseTo(Math.atan2(l1.y, l1.x), 9);
  });

  it('화면 맞추기 후 모든 세트가 화면 안에 들어온다', () => {
    for (const size of [
      { width: 1280, height: 720 },
      { width: 390, height: 640 },
      { width: 640, height: 390 },
    ]) {
      const v = fitRect(contentBounds(items, stage), size);
      for (const it of items) {
        const b = itemBounds(it);
        const tl = logicalToScreen(v, b);
        const br = logicalToScreen(v, { x: b.x + b.w, y: b.y + b.h });
        expect(tl.x).toBeGreaterThanOrEqual(0);
        expect(tl.y).toBeGreaterThanOrEqual(0);
        expect(br.x).toBeLessThanOrEqual(size.width);
        expect(br.y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it('화면↔논리 변환은 서로 역함수이고, 확대·축소 기준점은 고정된다', () => {
    const v = { scale: 0.7, x: 33, y: -12 };
    const p = { x: 123.4, y: 567.8 };
    const back = screenToLogical(v, logicalToScreen(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);

    const anchor = { x: 200, y: 150 };
    const before = screenToLogical(v, anchor);
    const z = zoomAt(v, anchor, 1.8);
    const after = screenToLogical(z, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('새 세트 생성 위치', () => {
  const stage = { width: 1600, height: 1000 };
  it('현재 보이는 영역 안에 생성하고, 여러 번 추가해도 서로 겹쳐 숨지 않는다', () => {
    const view = { scale: 1, x: -400, y: -200 }; // 논리 (400,200) ~ (1200, 800) 이 보임
    const visible = visibleLogicalRect(view, { width: 800, height: 600 });
    let d = createEmptyLayoutData();
    for (let i = 0; i < 12; i++) {
      const p = findSpawnPosition(d.items, 'stand_2chairs', visible, stage);
      d = addItem(d, makeItem({ kind: 'stand_2chairs', instrumentId: null, partId: null }, p.x, p.y));
    }
    const boxes = d.items.map(itemBounds);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(visible.x);
      expect(b.y).toBeGreaterThanOrEqual(visible.y);
      expect(b.x + b.w).toBeLessThanOrEqual(visible.x + visible.w);
      expect(b.y + b.h).toBeLessThanOrEqual(visible.y + visible.h);
    }
    const centers = new Set(d.items.map((i) => `${i.x},${i.y}`));
    expect(centers.size).toBe(12);
    // 서로 크게 겹치지 않음
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const overlap = w > 0 && h > 0 ? w * h : 0;
        expect(overlap).toBeLessThan(a.w * a.h * 0.1);
      }
    }
  });

  it('빈 자리가 없을 만큼 좁은 화면이어도 같은 자리에 완전히 겹치지 않는다', () => {
    const visible = { x: 500, y: 500, w: 160, h: 120 };
    let d = createEmptyLayoutData();
    for (let i = 0; i < 4; i++) {
      const p = findSpawnPosition(d.items, 'stand_1chair', visible, stage);
      d = addItem(d, makeItem({ kind: 'stand_1chair', instrumentId: null, partId: null }, p.x, p.y));
    }
    expect(new Set(d.items.map((i) => `${i.x},${i.y}`)).size).toBe(4);
  });
});

describe('템플릿 복사본의 독립성', () => {
  it('복사본을 수정해도 원본은 바뀌지 않는다', () => {
    let tpl = createEmptyLayoutData();
    tpl = addItem(tpl, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn1', labelSnapshot: { instrument: '바이올린' } }, 100, 100));
    const snapshot = JSON.stringify(tpl);
    const copy = cloneLayoutData(tpl);
    expect(copy.items[0].id).not.toBe(tpl.items[0].id);
    copy.items[0].x = 999;
    copy.items[0].labelSnapshot!.instrument = '변경';
    copy.spares.chairs = 10;
    const edited = updateItem(copy, copy.items[0].id, { rotation: 90 });
    expect(edited.items[0].rotation).toBe(90);
    expect(JSON.stringify(tpl)).toBe(snapshot);
  });
});

describe('지휘대 쪽 향하기', () => {
  it('세트 앞(보면대)이 목표점을 향하는 회전각을 계산한다', () => {
    const target = { x: 0, y: 0 };
    expect(faceAngle({ x: 0, y: -100 }, target)).toBe(0); // 목표가 아래(관객 쪽)
    expect(faceAngle({ x: -100, y: 0 }, target)).toBe(270); // 목표가 오른쪽
    expect(faceAngle({ x: 100, y: 0 }, target)).toBe(90); // 목표가 왼쪽
    expect(faceAngle({ x: 0, y: 100 }, target)).toBe(180); // 목표가 위
  });
});
