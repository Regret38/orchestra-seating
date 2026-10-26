import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { repo } from '../data';
import type { DemoRepository } from '../data/demoRepository';
import { friendlyError, type Repository } from '../data/repository';
import { indexCatalog, type CatalogIndex } from '../domain/labels';
import type { AppUser, Instrument, Invitation, Membership, Role, Team } from '../domain/types';

const TEAM_KEY = 'orchestra-seating:team';

export interface AppContextValue {
  repo: Repository;
  isDemo: boolean;
  /** undefined = 확인 중 */
  user: AppUser | null | undefined;
  memberships: Membership[] | null;
  invitations: Invitation[];
  teamsError: string | null;
  team: Team | null;
  role: Role | null;
  instruments: Instrument[];
  catalog: CatalogIndex;
  catalogError: string | null;
  catalogLoading: boolean;
  setTeam(id: string): void;
  refreshTeams(): Promise<void>;
  refreshInstruments(): Promise<void>;
  setDemoRole(role: Role): Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem(TEAM_KEY));
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const teamsRequest = useRef(0);
  const catalogRequest = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;

  // 로그인 상태
  useEffect(() => {
    let alive = true;
    repo
      .getUser()
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null));
    const off = repo.onAuthChange((u) => {
      if (userRef.current?.id !== u?.id) {
        teamsRequest.current++;
        catalogRequest.current++;
        setMemberships(null);
        setInvitations([]);
        setInstruments([]);
      }
      setUser((prev) => (prev?.id === u?.id ? prev : u));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const refreshTeams = useCallback(async () => {
    const request = ++teamsRequest.current;
    if (!user) {
      setMemberships(null);
      setInvitations([]);
      return;
    }
    setTeamsError(null);
    try {
      const [m, inv] = await Promise.all([repo.listMyTeams(), repo.listMyInvitations()]);
      if (request !== teamsRequest.current || userRef.current?.id !== user.id) return;
      setMemberships(m);
      setInvitations(inv);
    } catch (e) {
      if (request !== teamsRequest.current) return;
      setTeamsError(friendlyError(e));
      setMemberships([]);
    }
  }, [user]);

  useEffect(() => {
    setMemberships(null);
    void refreshTeams();
  }, [refreshTeams]);

  const membership = useMemo(() => {
    if (!user || !memberships || memberships.length === 0) return null;
    return memberships.find((m) => m.team.id === teamId) ?? memberships[0];
  }, [memberships, teamId, user]);

  const currentTeamId = membership?.team.id ?? null;
  const teamRef = useRef(currentTeamId);
  teamRef.current = currentTeamId;

  const refreshInstruments = useCallback(async () => {
    const request = ++catalogRequest.current;
    if (!currentTeamId) {
      setInstruments([]);
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const next = await repo.listInstruments(currentTeamId);
      if (request === catalogRequest.current && teamRef.current === currentTeamId) setInstruments(next);
    } catch (e) {
      if (request === catalogRequest.current) setCatalogError(friendlyError(e));
    } finally {
      if (request === catalogRequest.current) setCatalogLoading(false);
    }
  }, [currentTeamId]);

  useEffect(() => {
    setInstruments([]);
    void refreshInstruments();
    return () => { catalogRequest.current++; };
  }, [refreshInstruments]);

  const setTeam = useCallback((id: string) => {
    localStorage.setItem(TEAM_KEY, id);
    setTeamId(id);
  }, []);

  const setDemoRole = useCallback(
    async (role: Role) => {
      if (repo.mode !== 'demo') return;
      (repo as DemoRepository).setRole(role);
      await refreshTeams();
    },
    [refreshTeams],
  );

  const catalog = useMemo(() => indexCatalog(instruments), [instruments]);

  const value: AppContextValue = {
    repo,
    isDemo: repo.mode === 'demo',
    user,
    memberships,
    invitations,
    teamsError,
    team: membership?.team ?? null,
    role: membership?.role ?? null,
    instruments,
    catalog,
    catalogError,
    catalogLoading,
    setTeam,
    refreshTeams,
    refreshInstruments,
    setDemoRole,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider 가 필요합니다');
  return v;
}
