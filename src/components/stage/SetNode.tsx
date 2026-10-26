import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { getSetGeometry } from '../../domain/sets';
import { tint, type ResolvedLabel } from '../../domain/labels';
import type { StageItem } from '../../domain/types';

export const STAGE_FONT = "'Noto Sans KR Variable', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, fontSize: number, bold = false): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * fontSize * 0.9;
  measureCtx.font = `${bold ? 'bold ' : ''}${fontSize}px ${STAGE_FONT}`;
  return measureCtx.measureText(text).width;
}

export interface SetNodeProps {
  item: StageItem;
  label: ResolvedLabel;
  selected?: boolean;
  draggable?: boolean;
  /** 화면 배율 (선택 표시·손잡이를 화면 기준 일정 크기로 그리기 위함) */
  scale: number;
  labelFontSize: number;
  dragBoundFunc?: (pos: Konva.Vector2d) => Konva.Vector2d;
  onMouseDown?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onTap?: (e: Konva.KonvaEventObject<Event>) => void;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onRotateHandleDown?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  showRotateHandle?: boolean;
}

/**
 * 하나의 세트(보면대·의자·장의자 묶음).
 * 바깥 그룹은 위치만, 안쪽 그룹은 회전만 담당한다.
 * 이름표는 바깥 그룹에 있어 세트가 회전해도 항상 바로 선 방향으로 읽힌다.
 */
export function SetNode(props: SetNodeProps) {
  const { item, label, selected, scale, labelFontSize } = props;
  const g = getSetGeometry(item.kind, item.benchLength);
  const fill = tint(label.color, 0.72);
  const stroke = label.color;
  const px = 1 / Math.max(scale, 0.01); // 화면 1px 에 해당하는 논리 길이

  const fs = labelFontSize;
  const textW = measureText(label.display, fs, true);
  const padX = fs * 0.35;
  const padY = fs * 0.18;
  const boxW = textW + padX * 2;
  const boxH = fs * 1.2 + padY * 2;

  const handleDist = g.footprint.h / 2 + 30 * px;

  return (
    <Group
      name="set"
      id={item.id}
      x={item.x}
      y={item.y}
      draggable={props.draggable}
      dragBoundFunc={props.dragBoundFunc}
      onMouseDown={props.onMouseDown}
      onTap={props.onTap}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      <Group rotation={item.rotation}>
        {/* 터치하기 쉽도록 외곽 전체를 투명 영역으로 */}
        <Rect
          x={-g.footprint.w / 2 - 4}
          y={-g.footprint.h / 2 - 4}
          width={g.footprint.w + 8}
          height={g.footprint.h + 8}
          fill="rgba(0,0,0,0.001)"
        />
        {g.bench && (
          <>
            <Rect
              x={g.bench.x}
              y={g.bench.y}
              width={g.bench.w}
              height={g.bench.h}
              cornerRadius={6}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
            />
            {/* 등받이(뒤쪽) */}
            <Rect x={g.bench.x} y={g.bench.y} width={g.bench.w} height={8} cornerRadius={[6, 6, 0, 0]} fill={stroke} />
          </>
        )}
        {g.chairs.map((c, i) => (
          <Group key={i}>
            <Rect x={c.x} y={c.y} width={c.w} height={c.h} cornerRadius={6} fill={fill} stroke={stroke} strokeWidth={2} />
            <Rect x={c.x} y={c.y} width={c.w} height={8} cornerRadius={[6, 6, 0, 0]} fill={stroke} />
          </Group>
        ))}
        {g.stands.map((s, i) => (
          <Group key={i}>
            <Line points={[0, s.y + s.h / 2, 0, s.y - 9]} stroke="#334155" strokeWidth={3} />
            <Circle x={0} y={s.y - 10} radius={4} fill="#334155" />
            <Rect x={s.x} y={s.y} width={s.w} height={s.h} cornerRadius={2} fill="#1e293b" />
          </Group>
        ))}
        {selected && (
          <Rect
            x={-g.footprint.w / 2 - 6 * px}
            y={-g.footprint.h / 2 - 6 * px}
            width={g.footprint.w + 12 * px}
            height={g.footprint.h + 12 * px}
            stroke="#2563eb"
            strokeWidth={2.5 * px}
            dash={[8 * px, 5 * px]}
            cornerRadius={8 * px}
            listening={false}
          />
        )}
        {selected && props.showRotateHandle && (
          <Group>
            <Line
              points={[0, -g.footprint.h / 2 - 6 * px, 0, -handleDist]}
              stroke="#2563eb"
              strokeWidth={2 * px}
              listening={false}
            />
            <Circle
              name="rotate-handle"
              x={0}
              y={-handleDist}
              radius={11 * px}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={2.5 * px}
              hitStrokeWidth={24 * px}
              onMouseDown={props.onRotateHandleDown}
              onTouchStart={props.onRotateHandleDown}
            />
            <Text
              x={-8 * px}
              y={-handleDist - 8 * px}
              width={16 * px}
              height={16 * px}
              text="↻"
              fontSize={14 * px}
              align="center"
              verticalAlign="middle"
              fill="#2563eb"
              listening={false}
            />
          </Group>
        )}
      </Group>

      {/* 이름표: 회전하지 않음 */}
      <Group x={-boxW / 2} y={-boxH / 2}>
        <Rect
          width={boxW}
          height={boxH}
          cornerRadius={boxH / 3}
          fill={selected ? '#1d4ed8' : 'rgba(255,255,255,0.92)'}
          stroke={selected ? '#1d4ed8' : stroke}
          strokeWidth={Math.max(1, fs * 0.08)}
        />
        <Text
          x={padX}
          y={padY}
          width={textW + 1}
          height={fs * 1.2}
          text={label.display}
          fontSize={fs}
          fontStyle="bold"
          fontFamily={STAGE_FONT}
          verticalAlign="middle"
          fill={selected ? '#ffffff' : '#0f172a'}
          listening={false}
        />
      </Group>
    </Group>
  );
}
