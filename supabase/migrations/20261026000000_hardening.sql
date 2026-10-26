-- NULL CHECK 결과로 잘못된 JSON이 통과하지 않도록 한다.
alter table public.layouts drop constraint layouts_data_shape;
alter table public.layouts add constraint layouts_data_shape check (
  coalesce(
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'items') = 'array'
    and octet_length(data::text) < 2000000,
    false
  )
);

-- 같은 팀의 관리자 두 명이 동시에 자신을 강등/제거할 때도
-- 팀 행 잠금으로 마지막 관리자 검사를 직렬화한다.
create or replace function public.lock_membership_team()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1 from public.teams where id = old.team_id for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.lock_membership_team() from public, anon, authenticated;
create trigger team_members_lock_team before update or delete on public.team_members
  for each row execute function public.lock_membership_team();
