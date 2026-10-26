import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { authRedirectUrl } from '../config';
import { validateLayoutData } from '../domain/validation';
import type {
  AppUser,
  Instrument,
  Invitation,
  LayoutRecord,
  LayoutSummary,
  Member,
  Membership,
  Role,
} from '../domain/types';
import {
  RepoError,
  interpretSaveOutcome,
  type InstrumentInput,
  type LayoutPatch,
  type NewLayoutInput,
  type PartInput,
  type Repository,
  type SaveResult,
} from './repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const LAYOUT_COLUMNS =
  'id, team_id, kind, name, event_date, data, version, source_layout_id, created_by, updated_by, created_at, updated_at';

function toUser(u: User | null | undefined): AppUser | null {
  return u ? { id: u.id, email: u.email ?? '' } : null;
}

function toLayout(r: Row): LayoutRecord {
  const v = validateLayoutData(r.data);
  if (!v.ok) {
    throw new RepoError(`저장된 배치 데이터를 읽을 수 없습니다: ${v.errors[0]}`);
  }
  return {
    id: r.id,
    teamId: r.team_id,
    kind: r.kind,
    name: r.name,
    eventDate: r.event_date,
    data: v.value,
    version: r.version,
    sourceLayoutId: r.source_layout_id,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function check<T>(res: { data: T; error: any }): T {
  if (res.error) throw res.error;
  return res.data;
}

export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const;
  readonly client: SupabaseClient;

  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: {
        flowType: 'pkce', // 해시 라우터(#/...)와 충돌하지 않도록 ?code= 방식 사용
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  // ---- 인증 ----
  async getUser() {
    const { data } = await this.client.auth.getSession();
    return toUser(data.session?.user);
  }
  onAuthChange(cb: (u: AppUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // 콜백 안에서 다른 supabase 호출을 바로 하지 않는다(교착 방지)
      setTimeout(() => cb(toUser(session?.user)), 0);
    });
    return () => data.subscription.unsubscribe();
  }
  async signInWithPassword(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }
  async signUp(email: string, password: string) {
    const data = check(
      await this.client.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: authRedirectUrl() },
      }),
    );
    return { needsEmailConfirm: !data.session };
  }
  async sendMagicLink(email: string) {
    check(
      await this.client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true },
      }),
    );
  }
  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  private async uid(): Promise<string> {
    const u = await this.getUser();
    if (!u) throw new RepoError('로그인이 필요합니다.');
    return u.id;
  }

  // ---- 소속 ----
  async listMyTeams(): Promise<Membership[]> {
    const uid = await this.uid();
    const rows = check(
      await this.client.from('team_members').select('role, teams(id, name)').eq('user_id', uid),
    ) as Row[];
    return rows
      .filter((r) => r.teams)
      .map((r) => ({ role: r.role as Role, team: { id: r.teams.id, name: r.teams.name } }))
      .sort((a, b) => a.team.name.localeCompare(b.team.name, 'ko'));
  }
  async listMyInvitations(): Promise<Invitation[]> {
    const rows = check(await this.client.rpc('my_invitations')) as Row[];
    return (rows ?? []).map((r) => ({
      id: r.id,
      teamId: r.team_id,
      teamName: r.team_name,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    }));
  }
  async acceptInvitation(id: string): Promise<string> {
    return check(await this.client.rpc('accept_invitation', { p_invitation_id: id })) as string;
  }
  async declineInvitation(id: string) {
    check(await this.client.from('team_invitations').delete().eq('id', id));
  }

  // ---- 악기 ----
  async listInstruments(teamId: string): Promise<Instrument[]> {
    const rows = check(
      await this.client
        .from('instruments')
        .select('id, name, color, sort_order, allow_custom, is_active, parts(id, instrument_id, name, color, sort_order, is_active)')
        .eq('team_id', teamId)
        .order('sort_order'),
    ) as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      sortOrder: r.sort_order,
      allowCustom: r.allow_custom,
      isActive: r.is_active,
      parts: ((r.parts ?? []) as Row[])
        .map((p) => ({
          id: p.id,
          instrumentId: p.instrument_id,
          name: p.name,
          color: p.color,
          sortOrder: p.sort_order,
          isActive: p.is_active,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }
  async createInstrument(teamId: string, input: InstrumentInput) {
    check(
      await this.client.from('instruments').insert({
        team_id: teamId,
        name: input.name.trim(),
        color: input.color,
        allow_custom: !!input.allowCustom,
        is_active: input.isActive ?? true,
        sort_order: input.sortOrder ?? 1000,
      }),
    );
  }
  async updateInstrument(id: string, input: Partial<InstrumentInput>) {
    const patch: Row = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.color !== undefined) patch.color = input.color;
    if (input.allowCustom !== undefined) patch.allow_custom = input.allowCustom;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    const rows = check(await this.client.from('instruments').update(patch).eq('id', id).select('id')) as Row[];
    if (!rows.length) throw new RepoError('이 작업을 할 권한이 없습니다.', '42501');
  }
  async createPart(teamId: string, instrumentId: string, input: PartInput) {
    check(
      await this.client.from('parts').insert({
        team_id: teamId,
        instrument_id: instrumentId,
        name: input.name.trim(),
        color: input.color ?? null,
        is_active: input.isActive ?? true,
        sort_order: input.sortOrder ?? 100,
      }),
    );
  }
  async updatePart(id: string, input: Partial<PartInput>) {
    const patch: Row = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.color !== undefined) patch.color = input.color;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    const rows = check(await this.client.from('parts').update(patch).eq('id', id).select('id')) as Row[];
    if (!rows.length) throw new RepoError('이 작업을 할 권한이 없습니다.', '42501');
  }

  // ---- 배치 ----
  async listLayouts(teamId: string): Promise<LayoutSummary[]> {
    const rows = check(
      await this.client
        .from('layouts')
        .select('id, team_id, kind, name, event_date, version, updated_at, created_by, item_count')
        .eq('team_id', teamId)
        .order('updated_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      kind: r.kind,
      name: r.name,
      eventDate: r.event_date,
      version: r.version,
      updatedAt: r.updated_at,
      createdBy: r.created_by,
      itemCount: r.item_count ?? 0,
    }));
  }
  async getLayout(id: string): Promise<LayoutRecord | null> {
    const row = check(await this.client.from('layouts').select(LAYOUT_COLUMNS).eq('id', id).maybeSingle()) as Row | null;
    return row ? toLayout(row) : null;
  }
  async createLayout(input: NewLayoutInput): Promise<LayoutRecord> {
    const row = check(
      await this.client
        .from('layouts')
        .insert({
          team_id: input.teamId,
          kind: input.kind,
          name: input.name.trim(),
          event_date: input.eventDate,
          data: input.data,
          source_layout_id: input.sourceLayoutId ?? null,
        })
        .select(LAYOUT_COLUMNS)
        .single(),
    ) as Row;
    return toLayout(row);
  }
  async saveLayout(id: string, expectedVersion: number, patch: LayoutPatch): Promise<SaveResult> {
    try {
      // version 이 일치할 때만 갱신 → 다른 사람이 먼저 저장했다면 0건
      const res = await this.client
        .from('layouts')
        .update({ kind: patch.kind, name: patch.name.trim(), event_date: patch.eventDate, data: patch.data })
        .eq('id', id)
        .eq('version', expectedVersion)
        .select(LAYOUT_COLUMNS)
        .maybeSingle();
      if (res.error) throw res.error;
      if (res.data) return interpretSaveOutcome(toLayout(res.data as Row), null, expectedVersion);
      const latest = await this.getLayout(id);
      return interpretSaveOutcome(null, latest, expectedVersion);
    } catch (e: any) {
      return { ok: false, reason: 'error', message: e?.message ?? String(e) };
    }
  }
  async deleteLayout(id: string) {
    const rows = check(await this.client.from('layouts').delete().eq('id', id).select('id')) as Row[];
    if (!rows.length) throw new RepoError('삭제할 권한이 없거나 이미 삭제된 배치입니다.', '42501');
  }

  // ---- 팀 관리 ----
  async renameTeam(teamId: string, name: string) {
    const rows = check(await this.client.from('teams').update({ name: name.trim() }).eq('id', teamId).select('id')) as Row[];
    if (!rows.length) throw new RepoError('이 작업을 할 권한이 없습니다.', '42501');
  }
  async listMembers(teamId: string): Promise<Member[]> {
    const rows = check(
      await this.client.from('team_members').select('user_id, email, role, created_at').eq('team_id', teamId).order('created_at'),
    ) as Row[];
    return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role, createdAt: r.created_at }));
  }
  async updateMemberRole(teamId: string, userId: string, role: Role) {
    const rows = check(
      await this.client.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId).select('user_id'),
    ) as Row[];
    if (!rows.length) throw new RepoError('이 작업을 할 권한이 없습니다.', '42501');
  }
  async removeMember(teamId: string, userId: string) {
    const rows = check(
      await this.client.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId).select('user_id'),
    ) as Row[];
    if (!rows.length) throw new RepoError('이 작업을 할 권한이 없습니다.', '42501');
  }
  async listTeamInvitations(teamId: string): Promise<Invitation[]> {
    const rows = check(
      await this.client.from('team_invitations').select('id, team_id, email, role, created_at').eq('team_id', teamId).order('created_at'),
    ) as Row[];
    return rows.map((r) => ({ id: r.id, teamId: r.team_id, email: r.email, role: r.role, createdAt: r.created_at }));
  }
  async createInvitation(teamId: string, email: string, role: Role) {
    // 메일은 발송하지 않는다. 초대 기록만 만든다.
    check(await this.client.from('team_invitations').insert({ team_id: teamId, email: email.trim().toLowerCase(), role }));
  }
  async deleteInvitation(id: string) {
    check(await this.client.from('team_invitations').delete().eq('id', id));
  }
}
