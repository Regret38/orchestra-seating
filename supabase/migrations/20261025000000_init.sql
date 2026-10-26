-- =====================================================================
-- 오케스트라 무대 배치: 초기 스키마 + RLS
--
-- 적용 방법: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 실행
--           (또는 Supabase CLI: supabase db push)
--
-- 원칙
--  * 모든 업무 테이블은 RLS 활성화. 로그인만 했다고 팀 데이터가 보이지 않음.
--  * 팀 소속(team_members)은 초대 수락 함수 또는 SQL Editor(관리자)로만 생성.
--  * 권한: admin(관리자) / editor(편집자) / viewer(열람자)
--  * 배치 저장은 version 컬럼으로 낙관적 잠금(충돌 감지). version 은 트리거가 증가.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 타입
-- ---------------------------------------------------------------------
create type public.team_role as enum ('admin', 'editor', 'viewer');
create type public.layout_kind as enum ('template', 'event');

-- ---------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null default 'viewer',
  email text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_id_idx on public.team_members (user_id);

-- 초대: 메일을 자동 발송하지 않는다. 초대받은 이메일로 로그인한 사용자가 직접 수락한다.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$'),
  role public.team_role not null default 'viewer',
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);
create index team_invitations_email_idx on public.team_invitations (email);

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  allow_custom boolean not null default false, -- '기타 / 직접 입력'처럼 자유 이름을 허용
  is_active boolean not null default true,      -- false 면 선택 목록에서 숨김(기존 배치는 유지)
  created_at timestamptz not null default now(),
  unique (id, team_id)
);
create index instruments_team_id_idx on public.instruments (team_id);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  instrument_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- 파트는 반드시 같은 팀의 악기에 속한다
  foreign key (instrument_id, team_id) references public.instruments (id, team_id) on delete cascade
);
create index parts_instrument_id_idx on public.parts (instrument_id);

-- 템플릿(기본 배치)과 일정별 배치를 한 테이블에 저장. data 는 세트 목록·예비 수량(JSON).
create table public.layouts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  kind public.layout_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  event_date date,
  data jsonb not null,
  version integer not null default 1,
  source_layout_id uuid, -- 복사 원본(참고용, FK 아님: 원본 삭제와 무관하게 독립 보관)
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint layouts_data_shape check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'items') = 'array'
    and octet_length(data::text) < 2000000
  )
);
create index layouts_team_id_idx on public.layouts (team_id, kind, event_date desc);

-- ---------------------------------------------------------------------
-- 3. 권한 확인 함수 (security definer: RLS 재귀 방지)
-- ---------------------------------------------------------------------
create or replace function public.team_role_of(p_team_id uuid)
returns public.team_role
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.team_members m
  where m.team_id = p_team_id and m.user_id = auth.uid()
$$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.team_role_of(p_team_id) is not null
$$;

create or replace function public.has_team_role(p_team_id uuid, p_roles public.team_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.team_role_of(p_team_id) = any (p_roles), false)
$$;

create or replace function public.current_user_email()
returns text
language sql stable security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = auth.uid()
$$;

revoke execute on function public.team_role_of(uuid) from public, anon;
revoke execute on function public.is_team_member(uuid) from public, anon;
revoke execute on function public.has_team_role(uuid, public.team_role[]) from public, anon;
revoke execute on function public.current_user_email() from public, anon;
grant execute on function public.team_role_of(uuid) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.has_team_role(uuid, public.team_role[]) to authenticated;
grant execute on function public.current_user_email() to authenticated;

-- ---------------------------------------------------------------------
-- 4. 트리거
-- ---------------------------------------------------------------------

-- 배치: 작성자/버전/시각은 서버가 관리한다.
create or replace function public.layouts_before_insert()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.version := 1;
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.layouts_before_update()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is distinct from old.team_id then
    raise exception 'team_id 는 변경할 수 없습니다' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger layouts_before_insert before insert on public.layouts
  for each row execute function public.layouts_before_insert();
create trigger layouts_before_update before update on public.layouts
  for each row execute function public.layouts_before_update();

-- 팀원: 팀/사용자 변경 금지, 마지막 관리자 제거·강등 금지
create or replace function public.team_members_before_update()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id then
    raise exception '팀 또는 사용자는 변경할 수 없습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.team_members_keep_admin()
returns trigger language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.teams t where t.id = old.team_id)
     and not exists (
       select 1 from public.team_members m
       where m.team_id = old.team_id and m.role = 'admin'
     ) then
    raise exception 'last_admin: 팀에는 최소 1명의 관리자가 있어야 합니다' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger team_members_before_update before update on public.team_members
  for each row execute function public.team_members_before_update();
create trigger team_members_keep_admin after update or delete on public.team_members
  for each row execute function public.team_members_keep_admin();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;
alter table public.instruments enable row level security;
alter table public.parts enable row level security;
alter table public.layouts enable row level security;

-- teams
create policy teams_select on public.teams for select to authenticated
  using (public.is_team_member(id));
create policy teams_update on public.teams for update to authenticated
  using (public.has_team_role(id, '{admin}'))
  with check (public.has_team_role(id, '{admin}'));

-- team_members (추가는 초대 수락 함수로만)
create policy team_members_select on public.team_members for select to authenticated
  using (public.is_team_member(team_id));
create policy team_members_update on public.team_members for update to authenticated
  using (public.has_team_role(team_id, '{admin}'))
  with check (public.has_team_role(team_id, '{admin}'));
create policy team_members_delete on public.team_members for delete to authenticated
  using (public.has_team_role(team_id, '{admin}') or user_id = auth.uid());

-- team_invitations
create policy invitations_select on public.team_invitations for select to authenticated
  using (public.has_team_role(team_id, '{admin}') or email = public.current_user_email());
create policy invitations_insert on public.team_invitations for insert to authenticated
  with check (public.has_team_role(team_id, '{admin}'));
create policy invitations_delete on public.team_invitations for delete to authenticated
  using (public.has_team_role(team_id, '{admin}') or email = public.current_user_email());

-- instruments / parts: 팀원 조회, 관리자만 변경
create policy instruments_select on public.instruments for select to authenticated
  using (public.is_team_member(team_id));
create policy instruments_insert on public.instruments for insert to authenticated
  with check (public.has_team_role(team_id, '{admin}'));
create policy instruments_update on public.instruments for update to authenticated
  using (public.has_team_role(team_id, '{admin}'))
  with check (public.has_team_role(team_id, '{admin}'));
create policy instruments_delete on public.instruments for delete to authenticated
  using (public.has_team_role(team_id, '{admin}'));

create policy parts_select on public.parts for select to authenticated
  using (public.is_team_member(team_id));
create policy parts_insert on public.parts for insert to authenticated
  with check (public.has_team_role(team_id, '{admin}'));
create policy parts_update on public.parts for update to authenticated
  using (public.has_team_role(team_id, '{admin}'))
  with check (public.has_team_role(team_id, '{admin}'));
create policy parts_delete on public.parts for delete to authenticated
  using (public.has_team_role(team_id, '{admin}'));

-- layouts: 팀원 조회, 관리자·편집자 생성/수정, 삭제는 관리자 또는 본인이 만든 배치의 편집자
create policy layouts_select on public.layouts for select to authenticated
  using (public.is_team_member(team_id));
create policy layouts_insert on public.layouts for insert to authenticated
  with check (public.has_team_role(team_id, '{admin,editor}'));
create policy layouts_update on public.layouts for update to authenticated
  using (public.has_team_role(team_id, '{admin,editor}'))
  with check (public.has_team_role(team_id, '{admin,editor}'));
create policy layouts_delete on public.layouts for delete to authenticated
  using (
    public.has_team_role(team_id, '{admin}')
    or (public.has_team_role(team_id, '{editor}') and created_by = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 6. 테이블 권한 (anon 은 접근 불가, authenticated 는 필요한 컬럼만)
-- ---------------------------------------------------------------------
revoke all on public.teams, public.team_members, public.team_invitations,
              public.instruments, public.parts, public.layouts
  from anon, authenticated;

grant select on public.teams to authenticated;
grant update (name) on public.teams to authenticated;

grant select, delete on public.team_members to authenticated;
grant update (role) on public.team_members to authenticated;

grant select, delete on public.team_invitations to authenticated;
grant insert (team_id, email, role) on public.team_invitations to authenticated;

grant select, delete on public.instruments to authenticated;
grant insert (team_id, name, color, sort_order, allow_custom, is_active) on public.instruments to authenticated;
grant update (name, color, sort_order, allow_custom, is_active) on public.instruments to authenticated;

grant select, delete on public.parts to authenticated;
grant insert (team_id, instrument_id, name, color, sort_order, is_active) on public.parts to authenticated;
grant update (name, color, sort_order, is_active) on public.parts to authenticated;

grant select, delete on public.layouts to authenticated;
grant insert (team_id, kind, name, event_date, data, source_layout_id) on public.layouts to authenticated;
grant update (kind, name, event_date, data) on public.layouts to authenticated;

-- ---------------------------------------------------------------------
-- 7. 함수: 초대 수락
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_inv public.team_invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  if v_confirmed is null then
    raise exception 'email_not_confirmed: 이메일 인증 후 초대를 수락할 수 있습니다' using errcode = '42501';
  end if;

  select * into v_inv from public.team_invitations i
  where i.id = p_invitation_id
  for update;

  if not found or v_inv.email <> v_email then
    raise exception 'invitation_not_found: 초대를 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  insert into public.team_members (team_id, user_id, role, email)
  values (v_inv.team_id, v_uid, v_inv.role, v_email)
  on conflict (team_id, user_id) do nothing;

  delete from public.team_invitations where id = v_inv.id;
  return v_inv.team_id;
end;
$$;

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 내 이메일로 온 초대 목록 (팀 이름 포함). 초대받은 사람은 아직 팀원이 아니어서 teams 를 읽을 수 없으므로 함수로 제공.
create or replace function public.my_invitations()
returns table (id uuid, team_id uuid, team_name text, email text, role public.team_role, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.team_id, t.name, i.email, i.role, i.created_at
  from public.team_invitations i
  join public.teams t on t.id = i.team_id
  where i.email = public.current_user_email()
  order by i.created_at
$$;

revoke execute on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

-- 배치 목록에서 data 전체를 내려받지 않고 세트 수만 보여 주기 위한 계산 컬럼 (PostgREST: select=item_count)
create or replace function public.item_count(public.layouts)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_array_length($1.data -> 'items'), 0)
$$;

revoke execute on function public.item_count(public.layouts) from public, anon;
grant execute on function public.item_count(public.layouts) to authenticated;

-- ---------------------------------------------------------------------
-- 8. 함수: 기본 악기 목록 / 팀 생성 (SQL Editor 전용, 앱에서 호출 불가)
-- ---------------------------------------------------------------------
create or replace function public.seed_default_instruments(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.instruments (team_id, name, color, sort_order)
    values (p_team_id, '바이올린', '#2563eb', 10) returning id into v_id;
  insert into public.parts (team_id, instrument_id, name, color, sort_order) values
    (p_team_id, v_id, '제1바이올린', '#2563eb', 1),
    (p_team_id, v_id, '제2바이올린', '#0891b2', 2);

  insert into public.instruments (team_id, name, color, sort_order) values
    (p_team_id, '비올라', '#7c3aed', 20),
    (p_team_id, '첼로', '#c2410c', 30),
    (p_team_id, '더블베이스', '#92400e', 40);

  insert into public.instruments (team_id, name, color, sort_order)
    values (p_team_id, '플루트', '#16a34a', 50) returning id into v_id;
  insert into public.parts (team_id, instrument_id, name, sort_order) values
    (p_team_id, v_id, '플루트 1', 1),
    (p_team_id, v_id, '플루트 2', 2);

  insert into public.instruments (team_id, name, color, sort_order)
    values (p_team_id, '클라리넷', '#0d9488', 60) returning id into v_id;
  insert into public.parts (team_id, instrument_id, name, sort_order) values
    (p_team_id, v_id, '클라리넷 1', 1),
    (p_team_id, v_id, '클라리넷 2', 2);

  insert into public.instruments (team_id, name, color, sort_order, allow_custom) values
    (p_team_id, '오보에', '#65a30d', 70, false),
    (p_team_id, '바순', '#4d7c0f', 80, false),
    (p_team_id, '호른', '#ca8a04', 90, false),
    (p_team_id, '트럼펫', '#dc2626', 100, false),
    (p_team_id, '트롬본', '#be123c', 110, false),
    (p_team_id, '튜바', '#9f1239', 120, false),
    (p_team_id, '타악기', '#475569', 130, false),
    (p_team_id, '피아노', '#1f2937', 140, false),
    (p_team_id, '기타 / 직접 입력', '#64748b', 150, true);
end;
$$;

create or replace function public.admin_create_team(p_team_name text, p_admin_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_team_id uuid;
begin
  select u.id, lower(u.email) into v_user_id, v_email
  from auth.users u where lower(u.email) = lower(btrim(p_admin_email));

  if v_user_id is null then
    raise exception '해당 이메일로 가입한 사용자가 없습니다. 먼저 앱에서 회원가입하세요: %', p_admin_email;
  end if;

  insert into public.teams (name) values (btrim(p_team_name)) returning id into v_team_id;
  insert into public.team_members (team_id, user_id, role, email)
    values (v_team_id, v_user_id, 'admin', v_email);
  perform public.seed_default_instruments(v_team_id);
  return v_team_id;
end;
$$;

-- 앱(브라우저)에서는 호출할 수 없게 한다. SQL Editor(postgres 역할)에서만 실행.
revoke execute on function public.seed_default_instruments(uuid) from public, anon, authenticated;
revoke execute on function public.admin_create_team(text, text) from public, anon, authenticated;
