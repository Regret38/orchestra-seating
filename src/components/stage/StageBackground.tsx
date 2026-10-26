import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { ReactElement } from 'react';
import { FRONT_BAND, podiumPoint } from '../../domain/layoutOps';
import type { StageSize } from '../../domain/types';
import { STAGE_FONT } from './SetNode';

export const GRID_STEP = 50;
export const AUDIENCE_DEPTH = 150;

interface Props {
  stage: StageSize;
  showGrid: boolean;
  scale: number;
}

/** 무대 바닥·무대 앞(관객 방향)·격자·지휘대 표시 */
export function StageBackground({ stage, showGrid, scale }: Props) {
  const { width: W, height: H } = stage;
  const px = 1 / Math.max(scale, 0.01);
  const podium = podiumPoint(stage);

  const grid: ReactElement[] = [];
  if (showGrid) {
    for (let x = 0; x <= W; x += GRID_STEP) {
      const major = x % (GRID_STEP * 4) === 0;
      grid.push(
        <Line
          key={`gx${x}`}
          points={[x, 0, x, H]}
          stroke={major ? '#cbd5e1' : '#e5e7eb'}
          strokeWidth={(major ? 1.2 : 1) * px}
          listening={false}
        />,
      );
    }
    for (let y = 0; y <= H; y += GRID_STEP) {
      const major = y % (GRID_STEP * 4) === 0;
      grid.push(
        <Line
          key={`gy${y}`}
          points={[0, y, W, y]}
          stroke={major ? '#cbd5e1' : '#e5e7eb'}
          strokeWidth={(major ? 1.2 : 1) * px}
          listening={false}
        />,
      );
    }
  }

  return (
    <Group>
      {/* 관객석 */}
      <Rect name="floor" x={-40} y={H} width={W + 80} height={AUDIENCE_DEPTH} fill="#e8edf4" />
      <Text
        x={0}
        y={H + 40}
        width={W}
        text="관객석"
        align="center"
        fontSize={36}
        fontStyle="bold"
        fontFamily={STAGE_FONT}
        fill="#64748b"
        listening={false}
      />
      <Text
        x={0}
        y={H + 88}
        width={W}
        text="(지휘자 뒤쪽 · 객석 방향)"
        align="center"
        fontSize={20}
        fontFamily={STAGE_FONT}
        fill="#94a3b8"
        listening={false}
      />

      {/* 무대 바닥 */}
      <Rect name="floor" x={0} y={0} width={W} height={H} fill="#fffdf7" stroke="#94a3b8" strokeWidth={3} />
      {grid}

      {/* 무대 앞 띠 */}
      <Rect x={0} y={H - FRONT_BAND} width={W} height={FRONT_BAND} fill="#fef3c7" listening={false} />
      <Line points={[0, H, W, H]} stroke="#b45309" strokeWidth={6} listening={false} />
      <Text
        x={0}
        y={H - FRONT_BAND + 18}
        width={W}
        text="▼  무대 앞 (관객 방향)  ▼"
        align="center"
        fontSize={28}
        fontStyle="bold"
        fontFamily={STAGE_FONT}
        fill="#92400e"
        listening={false}
      />

      {/* 무대 뒤 */}
      <Text
        x={0}
        y={14}
        width={W}
        text="▲ 무대 뒤 ▲"
        align="center"
        fontSize={22}
        fontFamily={STAGE_FONT}
        fill="#94a3b8"
        listening={false}
      />
      <Text
        x={16}
        y={14}
        text="배치 안내도 · 실제 축척 아님"
        fontSize={18}
        fontFamily={STAGE_FONT}
        fill="#94a3b8"
        listening={false}
      />

      {/* 지휘대 참고 위치 */}
      <Circle
        x={podium.x}
        y={podium.y}
        radius={34}
        stroke="#a8a29e"
        strokeWidth={2}
        dash={[6, 5]}
        listening={false}
      />
      <Text
        x={podium.x - 60}
        y={podium.y + 38}
        width={120}
        text="지휘대"
        align="center"
        fontSize={16}
        fontFamily={STAGE_FONT}
        fill="#a8a29e"
        listening={false}
      />
    </Group>
  );
}
