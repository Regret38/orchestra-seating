import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type Konva from 'konva';
import { Layer, Rect, Stage } from 'react-konva';
import { resolveItemLabel, type CatalogIndex } from '../../domain/labels';
import { itemBounds } from '../../domain/sets';
import { unionRects } from '../../domain/viewport';
import type { LayoutData } from '../../domain/types';
import { SetNode } from './SetNode';
import { AUDIENCE_DEPTH, StageBackground } from './StageBackground';

export interface StaticStageHandle {
  toDataURL(pixelRatio?: number): string | null;
}

interface Props {
  data: LayoutData;
  catalog: CatalogIndex;
  /** 출력 이미지의 가로 픽셀 (CSS px) */
  width: number;
}

/**
 * 인쇄·PNG 용 정적 무대 그림. 조작 기능 없음.
 * 무대 전체 + 관객석 + 무대 밖에 놓인 세트까지 포함하도록 영역을 잡는다.
 */
export const StaticStage = forwardRef<StaticStageHandle, Props>(function StaticStage({ data, catalog, width }, ref) {
  const stageRef = useRef<Konva.Stage>(null);

  const area = useMemo(() => {
    const base = { x: -20, y: -20, w: data.stage.width + 40, h: data.stage.height + AUDIENCE_DEPTH + 30 };
    const u = unionRects([base, ...data.items.map(itemBounds)])!;
    return { x: u.x - 10, y: u.y - 10, w: u.w + 20, h: u.h + 20 };
  }, [data]);

  const scale = width / area.w;
  const height = Math.round(area.h * scale);

  useImperativeHandle(ref, () => ({
    toDataURL(pixelRatio = 2) {
      return stageRef.current?.toDataURL({ pixelRatio, mimeType: 'image/png' }) ?? null;
    },
  }));

  return (
    <Stage ref={stageRef} width={width} height={height} scaleX={scale} scaleY={scale} x={-area.x * scale} y={-area.y * scale} listening={false}>
      <Layer>
        <Rect x={area.x} y={area.y} width={area.w} height={area.h} fill="#ffffff" />
        <StageBackground stage={data.stage} showGrid={false} scale={scale} />
        {data.items.map((item) => (
          <SetNode key={item.id} item={item} label={resolveItemLabel(item, catalog)} scale={scale} labelFontSize={15} />
        ))}
      </Layer>
    </Stage>
  );
});
