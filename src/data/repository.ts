import type {
  AppUser,
  Instrument,
  Invitation,
  LayoutData,
  LayoutKind,
  LayoutRecord,
  LayoutSummary,
  Member,
  Membership,
  Role,
} from '../domain/types';

export type SaveResult =
  | { ok: true; record: LayoutRecord }
  | { ok: false; reason: 'conflict'; latest: LayoutRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'error'; message: string };

export interface NewLayoutInput {
  teamId: string;
  kind: LayoutKind;
  name: string;
  eventDate: string | null;
  data: LayoutData;
  sourceLayoutId?: string | null;
}

export interface LayoutPatch {
  kind: LayoutKind;
  name: string;
  eventDate: string | null;
  data: LayoutData;
}

export interface InstrumentInput {
  name: string;
  color: string;
  allowCustom?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface PartInput {
  name: string;
  color?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * 데이터 저장소 추상화.
 * - SupabaseRepository: 실제 온라인 저장 (RLS 로 권한 강제)
 * - DemoRepository: 브라우저 메모리에만 보관 (새로고침하면 사라짐)
 */
export interface Repository {
  readonly mode: 'demo' | 'supabase';

  // 인증
  getUser(): Promise<AppUser | null>;
  onAuthChange(cb: (user: AppUser | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsEmailConfirm: boolean }>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  // 소속
  listMyTeams(): Promise<Membership[]>;
  listMyInvitations(): Promise<Invitation[]>;
  acceptInvitation(id: string): Promise<string>;
  declineInvitation(id: string): Promise<void>;

  // 악기·파트
  listInstruments(teamId: string): Promise<Instrument[]>;
  createInstrument(teamId: string, input: InstrumentInput): Promise<void>;
  updateInstrument(id: string, input: Partial<InstrumentInput>): Promise<void>;
  createPart(teamId: string, instrumentId: string, input: PartInput): Promise<void>;
  updatePart(id: string, input: Partial<PartInput>): Promise<void>;

  // 배치
  listLayouts(teamId: string): Promise<LayoutSummary[]>;
  getLayout(id: string): Promise<LayoutRecord | null>;
  createLayout(input: NewLayoutInput): Promise<LayoutRecord>;
  /** expectedVersion 과 서버 버전이 다르면 저장하지 않고 conflict 를 돌려준다 */
  saveLayout(id: string, expectedVersion: number, patch: LayoutPatch): Promise<SaveResult>;
  deleteLayout(id: string): Promise<void>;

  // 팀 관리 (관리자)
  renameTeam(teamId: string, name: string): Promise<void>;
  listMembers(teamId: string): Promise<Member[]>;
  updateMemberRole(teamId: string, userId: string, role: Role): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
  listTeamInvitations(teamId: string): Promise<Invitation[]>;
  createInvitation(teamId: string, email: string, role: Role): Promise<void>;
  deleteInvitation(id: string): Promise<void>;
}

/**
 * 조건부 UPDATE 결과를 해석한다.
 * updated 가 없으면 최신 행을 다시 읽어 '충돌 / 삭제됨 / 권한 없음'을 구분한다.
 */
export function interpretSaveOutcome(
  updated: LayoutRecord | null,
  latest: LayoutRecord | null,
  expectedVersion: number,
): SaveResult {
  if (updated) return { ok: true, record: updated };
  if (!latest) return { ok: false, reason: 'not_found' };
  if (latest.version !== expectedVersion) return { ok: false, reason: 'conflict', latest };
  // 버전은 같은데 수정되지 않았다면 RLS 에 의해 거부된 것
  return { ok: false, reason: 'forbidden' };
}

export class RepoError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'RepoError';
  }
}

/** Supabase/PostgREST 오류를 사용자용 한국어 메시지로 바꾼다 */
export function friendlyError(err: unknown): string {
  const anyErr = err as { message?: string; code?: string } | null;
  const msg = anyErr?.message ?? String(err);
  const code = anyErr?.code;
  if (/Failed to fetch|NetworkError|network|fetch failed|Load failed/i.test(msg)) {
    return '서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return '이 작업을 할 권한이 없습니다. 팀 관리자에게 권한을 확인하세요.';
  }
  if (/last_admin/.test(msg)) return '팀에는 최소 1명의 관리자가 있어야 합니다.';
  if (/email_not_confirmed/.test(msg)) return '이메일 인증을 먼저 완료하세요. 받은 편지함의 인증 메일을 확인하세요.';
  if (/invitation_not_found/.test(msg)) return '초대를 찾을 수 없습니다. 이미 수락했거나 취소되었을 수 있습니다.';
  if (code === '23505' || /duplicate key/i.test(msg)) return '이미 같은 항목이 있습니다.';
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/Email not confirmed/i.test(msg)) return '이메일 인증이 완료되지 않았습니다. 받은 편지함의 인증 메일을 확인하세요.';
  if (/User already registered/i.test(msg)) return '이미 가입된 이메일입니다. 로그인하세요.';
  if (/Password should be at least/i.test(msg)) return '비밀번호가 너무 짧습니다(최소 6자 이상, 프로젝트 설정에 따라 더 길 수 있음).';
  if (/rate limit|too many/i.test(msg)) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  if (err instanceof RepoError) return msg;
  return `오류가 발생했습니다: ${msg}`;
}
