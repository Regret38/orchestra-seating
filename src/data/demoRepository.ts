import { buildDefaultInstruments } from '../domain/defaults';
import { newId } from '../domain/id';
import { cloneLayoutData } from '../domain/layoutOps';
import type {
  AppUser,
  Instrument,
  Invitation,
  LayoutRecord,
  LayoutSummary,
  Member,
  Membership,
  Role,
  Team,
} from '../domain/types';
import { buildDemoTemplateData } from './demoSample';
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

const DEMO_USER: AppUser = { id: 'demo-user', email: 'demo@example.invalid' };
const DEMO_TEAM: Team = { id: 'demo-team', name: '데모 오케스트라 (가상 데이터)' };

/**
 * 데모 저장소: 모든 데이터는 이 탭의 메모리에만 있다.
 * 새로고침하거나 탭을 닫으면 사라지며, 온라인에 저장되지 않는다.
 * 실제 서버와 같은 규칙(버전 충돌, 권한)을 흉내 낸다.
 */
export class DemoRepository implements Repository {
  readonly mode = 'demo' as const;
  private role: Role = 'admin';
  private instruments: Instrument[] = buildDefaultInstruments();
  private layouts = new Map<string, LayoutRecord>();
  private members: Member[] = [
    { userId: DEMO_USER.id, email: DEMO_USER.email, role: 'admin', createdAt: new Date().toISOString() },
  ];
  private invitations: Invitation[] = [];
  private listeners = new Set<(u: AppUser | null) => void>();
  private signedIn = true;
  /** 테스트용 지연(ms) */
  latencyMs = 120;

  constructor(seed = true) {
    if (seed) {
      const now = new Date();
      const tpl = this.insert({
        teamId: DEMO_TEAM.id,
        kind: 'template',
        name: '기본 배치 (예시)',
        eventDate: null,
        data: buildDemoTemplateData(),
      });
      const date = new Date(now.getTime() + 6 * 86400000).toISOString().slice(0, 10);
      this.insert({
        teamId: DEMO_TEAM.id,
        kind: 'event',
        name: '정기 연습 (예시)',
        eventDate: date,
        data: cloneLayoutData(tpl.data),
        sourceLayoutId: tpl.id,
      });
    }
  }

  // ---- 데모 전용 ----
  getRole(): Role {
    return this.role;
  }
  setRole(role: Role) {
    this.role = role;
    this.members[0] = { ...this.members[0], role };
  }
  /** 다른 사용자가 먼저 저장한 상황을 흉내 낸다(충돌 안내 확인용) */
  simulateExternalSave(id: string): boolean {
    const rec = this.layouts.get(id);
    if (!rec) return false;
    this.layouts.set(id, {
      ...rec,
      version: rec.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'other-demo-user',
      name: rec.name,
    });
    return true;
  }

  private async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }
  private requireEdit() {
    if (this.role === 'viewer') throw new RepoError('이 작업을 할 권한이 없습니다(열람자).', '42501');
  }
  private requireAdmin() {
    if (this.role !== 'admin') throw new RepoError('관리자만 할 수 있는 작업입니다.', '42501');
  }
  private insert(input: NewLayoutInput): LayoutRecord {
    const now = new Date().toISOString();
    const rec: LayoutRecord = {
      id: newId(),
      teamId: input.teamId,
      kind: input.kind,
      name: input.name,
      eventDate: input.eventDate,
      data: structuredClone(input.data),
      version: 1,
      sourceLayoutId: input.sourceLayoutId ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: DEMO_USER.id,
      updatedBy: DEMO_USER.id,
    };
    this.layouts.set(rec.id, rec);
    return structuredClone(rec);
  }

  // ---- 인증 ----
  async getUser() {
    return this.signedIn ? DEMO_USER : null;
  }
  onAuthChange(cb: (u: AppUser | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const l of this.listeners) l(this.signedIn ? DEMO_USER : null);
  }
  async signInWithPassword() {
    this.signedIn = true;
    this.emit();
  }
  async signUp() {
    this.signedIn = true;
    this.emit();
    return { needsEmailConfirm: false };
  }
  async sendMagicLink() {
    throw new RepoError('데모 모드에서는 메일을 보내지 않습니다.');
  }
  async signOut() {
    this.signedIn = false;
    this.emit();
  }

  // ---- 소속 ----
  async listMyTeams(): Promise<Membership[]> {
    await this.delay();
    return [{ team: { ...DEMO_TEAM }, role: this.role }];
  }
  async listMyInvitations(): Promise<Invitation[]> {
    return [];
  }
  async acceptInvitation(): Promise<string> {
    throw new RepoError('데모 모드에서는 초대를 수락할 수 없습니다.');
  }
  async declineInvitation() {}

  // ---- 악기 ----
  async listInstruments(): Promise<Instrument[]> {
    await this.delay();
    return structuredClone([...this.instruments].sort((a, b) => a.sortOrder - b.sortOrder));
  }
  async createInstrument(_teamId: string, input: InstrumentInput) {
    this.requireAdmin();
    const max = Math.max(0, ...this.instruments.map((i) => i.sortOrder));
    this.instruments.push({
      id: newId(),
      name: input.name,
      color: input.color,
      allowCustom: !!input.allowCustom,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? max + 10,
      parts: [],
    });
  }
  async updateInstrument(id: string, input: Partial<InstrumentInput>) {
    this.requireAdmin();
    this.instruments = this.instruments.map((i) => (i.id === id ? { ...i, ...input } : i));
  }
  async createPart(_teamId: string, instrumentId: string, input: PartInput) {
    this.requireAdmin();
    this.instruments = this.instruments.map((i) =>
      i.id === instrumentId
        ? {
            ...i,
            parts: [
              ...i.parts,
              {
                id: newId(),
                instrumentId,
                name: input.name,
                color: input.color ?? null,
                isActive: input.isActive ?? true,
                sortOrder: input.sortOrder ?? i.parts.length + 1,
              },
            ],
          }
        : i,
    );
  }
  async updatePart(id: string, input: Partial<PartInput>) {
    this.requireAdmin();
    this.instruments = this.instruments.map((i) => ({
      ...i,
      parts: i.parts.map((p) => (p.id === id ? { ...p, ...input, color: input.color === undefined ? p.color : input.color } : p)),
    }));
  }

  // ---- 배치 ----
  async listLayouts(teamId: string): Promise<LayoutSummary[]> {
    await this.delay();
    return [...this.layouts.values()]
      .filter((l) => l.teamId === teamId)
      .map((l) => ({
        id: l.id,
        teamId: l.teamId,
        kind: l.kind,
        name: l.name,
        eventDate: l.eventDate,
        version: l.version,
        updatedAt: l.updatedAt,
        createdBy: l.createdBy,
        itemCount: l.data.items.length,
      }));
  }
  async getLayout(id: string) {
    await this.delay();
    const rec = this.layouts.get(id);
    return rec ? structuredClone(rec) : null;
  }
  async createLayout(input: NewLayoutInput) {
    await this.delay();
    this.requireEdit();
    return this.insert(input);
  }
  async saveLayout(id: string, expectedVersion: number, patch: LayoutPatch): Promise<SaveResult> {
    await this.delay();
    const current = this.layouts.get(id) ?? null;
    let updated: LayoutRecord | null = null;
    if (current && current.version === expectedVersion && this.role !== 'viewer') {
      updated = {
        ...current,
        kind: patch.kind,
        name: patch.name,
        eventDate: patch.eventDate,
        data: structuredClone(patch.data),
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: DEMO_USER.id,
      };
      this.layouts.set(id, updated);
    }
    const latest = this.layouts.get(id) ?? null;
    return interpretSaveOutcome(
      updated ? structuredClone(updated) : null,
      latest ? structuredClone(latest) : null,
      expectedVersion,
    );
  }
  async deleteLayout(id: string) {
    await this.delay();
    this.requireEdit();
    this.layouts.delete(id);
  }

  // ---- 팀 관리 ----
  async renameTeam(_teamId: string, name: string) {
    this.requireAdmin();
    DEMO_TEAM.name = name;
  }
  async listMembers(): Promise<Member[]> {
    return structuredClone(this.members);
  }
  async updateMemberRole(_teamId: string, userId: string, role: Role) {
    this.requireAdmin();
    const admins = this.members.filter((m) => m.role === 'admin' && m.userId !== userId);
    if (role !== 'admin' && admins.length === 0) throw new RepoError('팀에는 최소 1명의 관리자가 있어야 합니다.');
    this.members = this.members.map((m) => (m.userId === userId ? { ...m, role } : m));
    if (userId === DEMO_USER.id) this.role = role;
  }
  async removeMember(_teamId: string, userId: string) {
    this.requireAdmin();
    if (userId === DEMO_USER.id) throw new RepoError('데모 사용자 본인은 제거할 수 없습니다.');
    this.members = this.members.filter((m) => m.userId !== userId);
  }
  async listTeamInvitations(): Promise<Invitation[]> {
    return structuredClone(this.invitations);
  }
  async createInvitation(teamId: string, email: string, role: Role) {
    this.requireAdmin();
    const e = email.trim().toLowerCase();
    if (this.invitations.some((i) => i.email === e)) throw new RepoError('이미 같은 항목이 있습니다.');
    this.invitations.push({ id: newId(), teamId, email: e, role, createdAt: new Date().toISOString() });
  }
  async deleteInvitation(id: string) {
    this.requireAdmin();
    this.invitations = this.invitations.filter((i) => i.id !== id);
  }
}
