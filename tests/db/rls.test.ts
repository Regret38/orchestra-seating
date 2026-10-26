import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

/**
 * 실제 마이그레이션 SQL 의 RLS·권한·트리거를 검증한다.
 * (Supabase 와 같은 PostgreSQL 엔진을 WASM 으로 실행)
 */

let t: TestDb;
const u = {} as Record<
  'adminA' | 'editorA' | 'editor2A' | 'viewerA' | 'adminB' | 'outsider' | 'unconfirmed',
  string
>;
let teamA = '';
let teamB = '';
let layoutA = '';

const sampleData = JSON.stringify({
  schemaVersion: 1,
  items: [{ id: 'i1', kind: 'stand_2chairs', x: 100, y: 200, rotation: 30 }],
  spares: { stands: 0, chairs: 0, benches: 0 },
});

async function inviteAndAccept(adminId: string, teamId: string, email: string, role: string, userId: string) {
  const [inv] = await t.as<{ id: string }>(
    adminId,
    `insert into public.team_invitations (team_id, email, role) values ($1, $2, $3) returning id`,
    [teamId, email, role],
  );
  await t.as(userId, `select public.accept_invitation($1)`, [inv.id]);
}

beforeAll(async () => {
  t = await createTestDb();
  u.adminA = await t.createUser('admin-a@example.com');
  u.editorA = await t.createUser('editor-a@example.com');
  u.editor2A = await t.createUser('editor2-a@example.com');
  u.viewerA = await t.createUser('viewer-a@example.com');
  u.adminB = await t.createUser('admin-b@example.com');
  u.outsider = await t.createUser('outsider@example.com');
  u.unconfirmed = await t.createUser('unconfirmed@example.com', false);

  [{ admin_create_team: teamA }] = await t.asPostgres<{ admin_create_team: string }>(
    `select public.admin_create_team('A 오케스트라', 'Admin-A@example.com')`,
  );
  [{ admin_create_team: teamB }] = await t.asPostgres<{ admin_create_team: string }>(
    `select public.admin_create_team('B 오케스트라', 'admin-b@example.com')`,
  );

  await inviteAndAccept(u.adminA, teamA, 'editor-a@example.com', 'editor', u.editorA);
  await inviteAndAccept(u.adminA, teamA, 'editor2-a@example.com', 'editor', u.editor2A);
  await inviteAndAccept(u.adminA, teamA, 'viewer-a@example.com', 'viewer', u.viewerA);

  [{ id: layoutA }] = await t.as<{ id: string }>(
    u.editorA,
    `insert into public.layouts (team_id, kind, name, data) values ($1, 'template', '기본 배치', $2::jsonb) returning id`,
    [teamA, sampleData],
  );
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('팀 생성(부트스트랩)', () => {
  it('admin_create_team 은 기본 악기·파트를 만들고 생성자를 관리자로 등록한다', async () => {
    const members = await t.asPostgres<{ role: string }>(
      `select role from public.team_members where team_id = $1 and user_id = $2`,
      [teamA, u.adminA],
    );
    expect(members).toEqual([{ role: 'admin' }]);
    const inst = await t.asPostgres<{ n: number }>(
      `select count(*)::int as n from public.instruments where team_id = $1`,
      [teamA],
    );
    expect(inst[0].n).toBe(15);
    const parts = await t.asPostgres<{ name: string }>(
      `select p.name from public.parts p join public.instruments i on i.id = p.instrument_id
       where i.team_id = $1 and i.name = '바이올린' order by p.sort_order`,
      [teamA],
    );
    expect(parts.map((p) => p.name)).toEqual(['제1바이올린', '제2바이올린']);
  });

  it('로그인 사용자는 브라우저에서 팀 생성 함수를 호출할 수 없다', async () => {
    await expect(
      t.as(u.outsider, `select public.admin_create_team('해킹', 'outsider@example.com')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('로그인하지 않은 사용자', () => {
  it.each(['teams', 'team_members', 'layouts', 'instruments', 'parts', 'team_invitations'])(
    '%s 테이블에 접근할 수 없다',
    async (table) => {
      await expect(t.as(null, `select * from public.${table}`)).rejects.toThrow(/permission denied/);
    },
  );
});

describe('가입·로그인만 한 사용자(팀 미소속)', () => {
  it('어떤 팀 데이터도 보이지 않는다', async () => {
    for (const table of ['teams', 'team_members', 'layouts', 'instruments', 'parts']) {
      const rows = await t.as(u.outsider, `select * from public.${table}`);
      expect(rows, table).toHaveLength(0);
    }
  });

  it('스스로 팀원으로 등록할 수 없다', async () => {
    await expect(
      t.as(
        u.outsider,
        `insert into public.team_members (team_id, user_id, role, email) values ($1, $2, 'admin', 'outsider@example.com')`,
        [teamA, u.outsider],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('스스로 초대를 만들 수 없다', async () => {
    await expect(
      t.as(u.outsider, `insert into public.team_invitations (team_id, email, role) values ($1, 'outsider@example.com', 'admin')`, [
        teamA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('초대', () => {
  it('다른 사람에게 온 초대는 볼 수도, 수락할 수도 없다', async () => {
    const [inv] = await t.as<{ id: string }>(
      u.adminA,
      `insert into public.team_invitations (team_id, email, role) values ($1, 'someone@example.com', 'editor') returning id`,
      [teamA],
    );
    expect(await t.as(u.outsider, `select * from public.team_invitations`)).toHaveLength(0);
    await expect(t.as(u.outsider, `select public.accept_invitation($1)`, [inv.id])).rejects.toThrow(
      /invitation_not_found/,
    );
  });

  it('이메일 인증을 하지 않은 사용자는 초대를 수락할 수 없다', async () => {
    const [inv] = await t.as<{ id: string }>(
      u.adminA,
      `insert into public.team_invitations (team_id, email, role) values ($1, 'unconfirmed@example.com', 'viewer') returning id`,
      [teamA],
    );
    // 본인에게 온 초대는 볼 수 있다
    expect(await t.as(u.unconfirmed, `select id from public.team_invitations`)).toEqual([{ id: inv.id }]);
    await expect(t.as(u.unconfirmed, `select public.accept_invitation($1)`, [inv.id])).rejects.toThrow(
      /email_not_confirmed/,
    );
  });

  it('편집자는 초대를 만들 수 없다', async () => {
    await expect(
      t.as(u.editorA, `insert into public.team_invitations (team_id, email, role) values ($1, 'x@example.com', 'admin')`, [
        teamA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it('수락하면 지정한 역할로 팀원이 되고 초대는 사라진다', async () => {
    const rows = await t.as<{ role: string }>(
      u.viewerA,
      `select role from public.team_members where user_id = auth.uid()`,
    );
    expect(rows).toEqual([{ role: 'viewer' }]);
    expect(
      await t.asPostgres(`select * from public.team_invitations where email = 'viewer-a@example.com'`),
    ).toHaveLength(0);
  });
});

describe('열람자', () => {
  it('배치를 조회할 수 있다', async () => {
    const rows = await t.as(u.viewerA, `select id from public.layouts where id = $1`, [layoutA]);
    expect(rows).toHaveLength(1);
  });

  it('배치를 만들 수 없다', async () => {
    await expect(
      t.as(u.viewerA, `insert into public.layouts (team_id, kind, name, data) values ($1, 'event', 'x', $2::jsonb)`, [
        teamA,
        sampleData,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it('배치를 수정·삭제할 수 없다(0건 처리, 원본 유지)', async () => {
    const upd = await t.as(u.viewerA, `update public.layouts set name = '변조' where id = $1 returning id`, [layoutA]);
    expect(upd).toHaveLength(0);
    const del = await t.as(u.viewerA, `delete from public.layouts where id = $1 returning id`, [layoutA]);
    expect(del).toHaveLength(0);
    const [row] = await t.asPostgres<{ name: string }>(`select name from public.layouts where id = $1`, [layoutA]);
    expect(row.name).toBe('기본 배치');
  });

  it('악기·파트를 바꿀 수 없다', async () => {
    const upd = await t.as(u.viewerA, `update public.instruments set name = '변조' where team_id = $1 returning id`, [
      teamA,
    ]);
    expect(upd).toHaveLength(0);
    await expect(
      t.as(u.viewerA, `insert into public.instruments (team_id, name) values ($1, '새 악기')`, [teamA]),
    ).rejects.toThrow(/row-level security/);
  });

  it('자기 역할을 올릴 수 없다', async () => {
    const upd = await t.as(
      u.viewerA,
      `update public.team_members set role = 'admin' where user_id = auth.uid() returning role`,
    );
    expect(upd).toHaveLength(0);
  });
});

describe('편집자', () => {
  it('items가 누락되거나 null인 데이터도 거부한다', async () => {
    for (const data of ['{}', '{"items":null}']) {
      await expect(t.as(u.editorA, `insert into public.layouts (team_id, kind, name, data) values ($1, 'event', 'invalid', $2::jsonb)`, [teamA, data])).rejects.toThrow(/layouts_data_shape/);
    }
  });
  it('저장할 때마다 서버가 version 을 1씩 올린다', async () => {
    const [before] = await t.asPostgres<{ version: number }>(`select version from public.layouts where id = $1`, [
      layoutA,
    ]);
    const [after] = await t.as<{ version: number; updated_by: string }>(
      u.editor2A,
      `update public.layouts set name = '기본 배치' where id = $1 and version = $2 returning version, updated_by`,
      [layoutA, before.version],
    );
    expect(after.version).toBe(before.version + 1);
    expect(after.updated_by).toBe(u.editor2A);
  });

  it('version·작성자·팀을 직접 바꿀 수 없다', async () => {
    await expect(t.as(u.editorA, `update public.layouts set version = 999 where id = $1`, [layoutA])).rejects.toThrow(
      /permission denied/,
    );
    await expect(t.as(u.editorA, `update public.layouts set team_id = $2 where id = $1`, [layoutA, teamB])).rejects.toThrow(
      /permission denied/,
    );
  });

  it('다른 사람이 만든 배치는 삭제할 수 없지만 관리자는 가능하다', async () => {
    const [{ id }] = await t.as<{ id: string }>(
      u.editor2A,
      `insert into public.layouts (team_id, kind, name, data) values ($1, 'event', '삭제 테스트', $2::jsonb) returning id`,
      [teamA, sampleData],
    );
    expect(await t.as(u.editorA, `delete from public.layouts where id = $1 returning id`, [id])).toHaveLength(0);
    expect(await t.as(u.adminA, `delete from public.layouts where id = $1 returning id`, [id])).toHaveLength(1);
  });

  it('잘못된 형식의 data 는 거부된다', async () => {
    await expect(
      t.as(u.editorA, `insert into public.layouts (team_id, kind, name, data) values ($1, 'event', 'x', '{"items": 3}'::jsonb)`, [
        teamA,
      ]),
    ).rejects.toThrow(/layouts_data_shape/);
  });
});

describe('저장 충돌 감지 (version 기반 낙관적 잠금)', () => {
  it('같은 버전을 기준으로 두 명이 저장하면 두 번째 저장은 0건이 되어 덮어쓰지 않는다', async () => {
    const [{ version: v }] = await t.asPostgres<{ version: number }>(
      `select version from public.layouts where id = $1`,
      [layoutA],
    );
    const first = await t.as<{ version: number }>(
      u.editorA,
      `update public.layouts set name = '편집자1 저장' where id = $1 and version = $2 returning version`,
      [layoutA, v],
    );
    expect(first).toEqual([{ version: v + 1 }]);

    const second = await t.as(
      u.editor2A,
      `update public.layouts set name = '편집자2 저장' where id = $1 and version = $2 returning version`,
      [layoutA, v],
    );
    expect(second).toHaveLength(0);

    const [row] = await t.asPostgres<{ name: string; version: number }>(
      `select name, version from public.layouts where id = $1`,
      [layoutA],
    );
    expect(row).toEqual({ name: '편집자1 저장', version: v + 1 });
  });
});

describe('다른 팀 데이터', () => {
  it('B팀 관리자는 A팀 배치·악기·팀원을 볼 수 없다', async () => {
    for (const table of ['layouts', 'instruments', 'parts', 'team_members', 'teams']) {
      const rows = await t.as<{ team_id?: string; id?: string }>(u.adminB, `select * from public.${table}`);
      for (const r of rows) {
        expect(r.team_id ?? r.id, table).toBe(teamB);
      }
    }
    expect(await t.as(u.adminB, `select * from public.layouts where id = $1`, [layoutA])).toHaveLength(0);
  });

  it('B팀 관리자는 A팀에 배치를 만들거나 수정·삭제할 수 없다', async () => {
    await expect(
      t.as(u.adminB, `insert into public.layouts (team_id, kind, name, data) values ($1, 'event', '침입', $2::jsonb)`, [
        teamA,
        sampleData,
      ]),
    ).rejects.toThrow(/row-level security/);
    expect(await t.as(u.adminB, `update public.layouts set name = '침입' where id = $1 returning id`, [layoutA])).toHaveLength(0);
    expect(await t.as(u.adminB, `delete from public.layouts where id = $1 returning id`, [layoutA])).toHaveLength(0);
  });

  it('B팀 관리자는 A팀 사용자 권한을 바꾸거나 초대할 수 없다', async () => {
    expect(
      await t.as(u.adminB, `update public.team_members set role = 'viewer' where team_id = $1 returning role`, [teamA]),
    ).toHaveLength(0);
    await expect(
      t.as(u.adminB, `insert into public.team_invitations (team_id, email, role) values ($1, 'admin-b@example.com', 'admin')`, [
        teamA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it('A팀 악기에 B팀 파트를 붙일 수 없다', async () => {
    const [inst] = await t.asPostgres<{ id: string }>(`select id from public.instruments where team_id = $1 limit 1`, [
      teamA,
    ]);
    await expect(
      t.as(u.adminB, `insert into public.parts (team_id, instrument_id, name) values ($1, $2, '침입 파트')`, [teamB, inst.id]),
    ).rejects.toThrow();
  });
});

describe('관리자', () => {
  it('악기를 추가하고 이름을 바꿀 수 있다', async () => {
    const [inst] = await t.as<{ id: string }>(
      u.adminA,
      `insert into public.instruments (team_id, name, color) values ($1, '하프', '#aa00aa') returning id`,
      [teamA],
    );
    const [renamed] = await t.as<{ name: string }>(
      u.adminA,
      `update public.instruments set name = '하프(콘서트)' where id = $1 returning name`,
      [inst.id],
    );
    expect(renamed.name).toBe('하프(콘서트)');
    await t.as(u.adminA, `insert into public.parts (team_id, instrument_id, name) values ($1, $2, '하프 1')`, [teamA, inst.id]);
  });

  it('팀원 역할을 변경할 수 있다', async () => {
    const [row] = await t.as<{ role: string }>(
      u.adminA,
      `update public.team_members set role = 'editor' where team_id = $1 and user_id = $2 returning role`,
      [teamA, u.viewerA],
    );
    expect(row.role).toBe('editor');
    await t.as(u.adminA, `update public.team_members set role = 'viewer' where team_id = $1 and user_id = $2`, [
      teamA,
      u.viewerA,
    ]);
  });

  it('마지막 관리자는 강등·탈퇴할 수 없다', async () => {
    await expect(
      t.as(u.adminA, `update public.team_members set role = 'editor' where team_id = $1 and user_id = $2`, [teamA, u.adminA]),
    ).rejects.toThrow(/last_admin/);
    await expect(
      t.as(u.adminA, `delete from public.team_members where team_id = $1 and user_id = $2`, [teamA, u.adminA]),
    ).rejects.toThrow(/last_admin/);
  });

  it('팀을 삭제하면 팀원·배치도 함께 삭제된다(마지막 관리자 검사에 막히지 않음)', async () => {
    const [{ admin_create_team: tmp }] = await t.asPostgres<{ admin_create_team: string }>(
      `select public.admin_create_team('임시 팀', 'outsider@example.com')`,
    );
    await t.asPostgres(`delete from public.teams where id = $1`, [tmp]);
    expect(await t.asPostgres(`select * from public.team_members where team_id = $1`, [tmp])).toHaveLength(0);
  });
});
