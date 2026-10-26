import { useCallback, useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Layer, Stage } from 'react-konva';
import { resolveItemLabel, type CatalogIndex } from '../../domain/labels';
import { normalizeRotation } from '../../domain/sets';
import { screenToLogical, clampScale, zoomAt } from '../../domain/viewport';
import type { LayoutData } from '../../domain/types';
import { useView } from '../../state/viewStore';
import { useCoarsePointer } from '../../hooks/useMediaQuery';
import { SetNode } from './SetNode';
import { GRID_STEP, StageBackground } from './StageBackground';

// 두 손가락 확대 중에도 터치 이벤트를 받도록
Konva.hitOnDragEnabled = true;

export interface StageCanvasProps {
  data: LayoutData;
  catalog: CatalogIndex;
  selectedId: string | null;
  editable: boolean;
  showGrid: boolean;
  snap: boolean;
  onSelect(id: string | null): void;
  onMoveEnd(id: string, x: number, y: number): void;
  onRotateStart(id: string): void;
  onRotate(id: string, rotation: number): void;
  onRotateEnd(): void;
}

/**
 * 대화형 무대 편집 화면 (Konva 캔버스)
 *
 * 조작 방식
 *  - 마우스: 세트를 끌면 이동, 빈 곳을 끌면 화면 이동, 휠로 확대·축소
 *  - 터치: 세트를 탭해 선택 → 선택된 세트만 끌어서 이동
 *          선택되지 않은 곳을 끌면 화면 이동, 두 손가락으로 확대·축소
 *    (화면 이동과 세트 이동이 섞이지 않도록 구분)
 */
export function StageCanvas(props: StageCanvasProps) {
  const { data, catalog, selectedId, editable, showGrid, snap } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const view = useView((s) => s.view);
  const size = useView((s) => s.size);
  const setView = useView((s) => s.setView);
  const setSize = useView((s) => s.setSize);
  const coarse = useCoarsePointer();

  const viewRef = useRef(view);
  viewRef.current = view;
  const propsRef = useRef(props);
  propsRef.current = props;

  const rotatingId = useRef<string | null>(null);
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const movedFar = useRef(false);

  // 컨테이너 크기 추적. 크기가 바뀌면 화면 가운데의 논리 지점을 유지한다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(1, Math.floor(el.clientWidth));
      const h = Math.max(1, Math.floor(el.clientHeight));
      const { size: prev, view: v } = useView.getState();
      if (prev.width === w && prev.height === h) return;
      const center = screenToLogical(v, { x: prev.width / 2, y: prev.height / 2 });
      setSize({ width: w, height: h });
      setView({ scale: v.scale, x: w / 2 - center.x * v.scale, y: h / 2 - center.y * v.scale });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setSize, setView]);

  // 마우스를 캔버스 밖에서 놓아도 회전 동작을 끝낸다
  useEffect(() => {
    const end = () => {
      if (rotatingId.current) {
        rotatingId.current = null;
        propsRef.current.onRotateEnd();
      }
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  const labels = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveItemLabel>>();
    for (const it of data.items) m.set(it.id, resolveItemLabel(it, catalog));
    return m;
  }, [data.items, catalog]);

  // 선택한 세트를 맨 위에 그린다
  const orderedItems = useMemo(() => {
    if (!selectedId) return data.items;
    const sel = data.items.find((i) => i.id === selectedId);
    return sel ? [...data.items.filter((i) => i.id !== selectedId), sel] : data.items;
  }, [data.items, selectedId]);

  const snapStep = snap ? GRID_STEP / 2 : null;
  const dragBound = useCallback(
    (pos: Konva.Vector2d): Konva.Vector2d => {
      if (!snapStep) return pos;
      const v = viewRef.current;
      const l = screenToLogical(v, pos);
      const sx = Math.round(l.x / snapStep) * snapStep;
      const sy = Math.round(l.y / snapStep) * snapStep;
      return { x: sx * v.scale + v.x, y: sy * v.scale + v.y };
    },
    [snapStep],
  );

  const pointerLogical = () => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    return p ? screenToLogical(viewRef.current, p) : null;
  };

  const handleRotateMove = () => {
    const id = rotatingId.current;
    if (!id) return;
    const item = propsRef.current.data.items.find((i) => i.id === id);
    const p = pointerLogical();
    if (!item || !p) return;
    let deg = (Math.atan2(p.x - item.x, -(p.y - item.y)) * 180) / Math.PI;
    const step = propsRef.current.snap ? 15 : 1;
    deg = Math.round(deg / step) * step;
    // 90° 단위 근처에서는 살짝 붙임
    const near = Math.round(deg / 90) * 90;
    if (Math.abs(deg - near) <= 3) deg = near;
    propsRef.current.onRotate(id, normalizeRotation(deg));
  };

  const stopItemDrags = () => {
    stageRef.current?.find('.set').forEach((n) => {
      if (n.isDragging()) n.stopDrag();
    });
  };

  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length >= 2) {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      if (stage.isDragging()) stage.stopDrag();
      stopItemDrags();
      if (rotatingId.current) {
        rotatingId.current = null;
        propsRef.current.onRotateEnd();
      }
      const rect = stage.container().getBoundingClientRect();
      const p1 = { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top };
      const p2 = { x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top };
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (!pinch.current || pinch.current.dist === 0) {
        pinch.current = { dist, center };
        return;
      }
      const v = viewRef.current;
      const anchor = screenToLogical(v, pinch.current.center);
      const scale = clampScale(v.scale * (dist / pinch.current.dist));
      setView({ scale, x: center.x - anchor.x * scale, y: center.y - anchor.y * scale });
      pinch.current = { dist, center };
      movedFar.current = true;
      return;
    }
    if (rotatingId.current) {
      e.evt.preventDefault();
      handleRotateMove();
    }
    trackMove();
  };

  const trackMove = () => {
    const p = stageRef.current?.getPointerPosition();
    if (p && downPos.current && Math.hypot(p.x - downPos.current.x, p.y - downPos.current.y) > 6) movedFar.current = true;
  };

  const onPointerDownStage = () => {
    downPos.current = stageRef.current?.getPointerPosition() ?? null;
    movedFar.current = false;
  };

  const isEmptyTarget = (t: Konva.Node) => t === stageRef.current || t.name() === 'floor';

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    const k = e.evt.ctrlKey ? 0.01 : 0.0015;
    const factor = Math.exp(-e.evt.deltaY * k);
    setView(zoomAt(viewRef.current, p, factor));
  };

  const labelFontSize = Math.min(20, Math.max(13, 9 / view.scale));

  return (
    <div
      ref={containerRef}
      className="stage-container"
      data-testid="stage"
      aria-label="무대 배치 편집 영역"
      role="application"
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable
        onWheel={onWheel}
        onMouseDown={onPointerDownStage}
        onTouchStart={(e) => {
          if (e.evt.touches.length === 1) onPointerDownStage();
          else pinch.current = null;
        }}
        onMouseMove={() => {
          handleRotateMove();
          trackMove();
        }}
        onTouchMove={onTouchMove}
        onTouchEnd={(e) => {
          if (e.evt.touches.length < 2) pinch.current = null;
        }}
        onMouseUp={() => {
          if (rotatingId.current) {
            rotatingId.current = null;
            propsRef.current.onRotateEnd();
          }
        }}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setView({ ...viewRef.current, x: e.target.x(), y: e.target.y() });
          }
        }}
        onClick={(e) => {
          if (isEmptyTarget(e.target) && !movedFar.current) props.onSelect(null);
        }}
        onTap={(e) => {
          if (isEmptyTarget(e.target) && !movedFar.current) props.onSelect(null);
        }}
      >
        <Layer>
          <StageBackground stage={data.stage} showGrid={showGrid} scale={view.scale} />
        </Layer>
        <Layer>
          {orderedItems.map((item) => {
            const selected = item.id === selectedId;
            return (
              <SetNode
                key={item.id}
                item={item}
                label={labels.get(item.id)!}
                selected={selected}
                scale={view.scale}
                labelFontSize={labelFontSize}
                draggable={editable && (selected || !coarse)}
                dragBoundFunc={dragBound}
                showRotateHandle={editable}
                onMouseDown={(e) => {
                  if (e.evt.button === 0) props.onSelect(item.id);
                }}
                onTap={() => {
                  if (!movedFar.current) props.onSelect(item.id);
                }}
                onDragStart={() => {
                  props.onSelect(item.id);
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  const x = Math.round(e.target.x());
                  const y = Math.round(e.target.y());
                  if (x !== item.x || y !== item.y) props.onMoveEnd(item.id, x, y);
                }}
                onRotateHandleDown={(e) => {
                  e.cancelBubble = true; // 세트 이동·화면 이동이 시작되지 않게
                  if (!editable) return;
                  rotatingId.current = item.id;
                  props.onRotateStart(item.id);
                }}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
