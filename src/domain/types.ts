/**
 * 도메인 타입 정의.
 * 무대 좌표는 화면 픽셀이 아니라 "논리 좌표(단위)"로 저장한다.
 * 화면 크기·확대 배율과 무관하게 같은 배치 관계가 복원된다.
 */

export type SetKind = 'stand_2chairs' | 'stand_1chair' | 'stand_only' | 'chair_only' | 'bench';

export const SET_KINDS: readonly SetKind[] = [
  'stand_2chairs',
  'stand_1chair',
  'stand_only',
  'chair_only',
  'bench',
] as const;

export type Role = 'admin' | 'editor' | 'viewer';
export type LayoutKind = 'template' | 'event';

/** 무대에 놓인 하나의 세트(배치 객체) */
export interface StageItem {
  id: string;
  kind: SetKind;
  /** 세트 중심의 논리 좌표 */
  x: number;
  y: number;
  /** 도(degree), 0 = 보면대가 무대 앞(관객) 방향 */
  rotation: number;
  /** 장의자 길이(논리 단위). 장의자에만 사용, 수량에는 영향 없음 */
  benchLength?: number;
  /** null = 미지정/공용 */
  instrumentId: string | null;
  partId: string | null;
  /** '직접 입력' 악기일 때 표시 이름 */
  customLabel?: string;
  /** 악기가 삭제되었거나 다른 팀에서 가져온 경우를 위한 이름 사본 */
  labelSnapshot?: { instrument?: string; part?: string };
}

export interface Spares {
  stands: number;
  chairs: number;
  benches: number;
}

export interface StageSize {
  width: number;
  height: number;
}

/** layouts.data 에 저장되는 JSON */
export interface LayoutData {
  schemaVersion: 1;
  stage: StageSize;
  items: StageItem[];
  spares: Spares;
}

export interface Part {
  id: string;
  instrumentId: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Instrument {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  allowCustom: boolean;
  isActive: boolean;
  parts: Part[];
}

export interface LayoutSummary {
  id: string;
  teamId: string;
  kind: LayoutKind;
  name: string;
  eventDate: string | null;
  version: number;
  updatedAt: string;
  createdBy: string | null;
  itemCount: number;
}

export interface LayoutRecord extends Omit<LayoutSummary, 'itemCount'> {
  data: LayoutData;
  sourceLayoutId: string | null;
  createdAt: string;
  updatedBy: string | null;
}

export interface Team {
  id: string;
  name: string;
}

export interface Membership {
  team: Team;
  role: Role;
}

export interface Member {
  userId: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Invitation {
  id: string;
  teamId: string;
  teamName?: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface AppUser {
  id: string;
  email: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: '관리자',
  editor: '편집자',
  viewer: '열람자',
};

export const LAYOUT_KIND_LABELS: Record<LayoutKind, string> = {
  template: '템플릿(기본 배치)',
  event: '일정',
};

export function canEdit(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'editor';
}

export function canDeleteLayout(
  role: Role | null | undefined,
  layout: { createdBy: string | null },
  userId: string | null | undefined,
): boolean {
  if (role === 'admin') return true;
  return role === 'editor' && !!userId && layout.createdBy === userId;
}
