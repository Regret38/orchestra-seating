/**
 * PGlite(WASM PostgreSQL) 위에 Supabase 의 auth 스키마·역할을 흉내 내고
 * 실제 마이그레이션 SQL 을 적용해 RLS 를 검증하기 위한 도구.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text not null,
  email_confirmed_at timestamptz
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

export interface TestDb {
  db: PGlite;
  /** 관리자(postgres)로 실행 */
  asPostgres<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 특정 사용자(authenticated) 또는 비로그인(anon)으로 실행 */
  as<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  createUser(email: string, confirmed?: boolean): Promise<string>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);

  const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  // 실행 단위마다 역할을 바꾸고 원래대로 돌린다.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  async function asPostgres<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return serial(async () => (await db.query<T>(sql, params)).rows);
  }

  async function as<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return serial(async () => {
      const role = userId ? 'authenticated' : 'anon';
      const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
      await db.exec(`set role ${role}`);
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claims', '', false)`);
      }
    });
  }

  async function createUser(email: string, confirmed = true): Promise<string> {
    const id = crypto.randomUUID();
    await asPostgres(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, ${confirmed ? 'now()' : 'null'})`,
      [id, email],
    );
    return id;
  }

  return { db, asPostgres, as, createUser, close: () => db.close() };
}
