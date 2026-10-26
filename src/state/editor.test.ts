import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DemoRepository } from '../data/demoRepository';
import { interpretSaveOutcome, type Repository } from '../data/repository';
import { DEFAULT_INSTRUMENT_SEEDS } from '../domain/defaults';
import { addItem, cloneLayoutData, createEmptyLayoutData, makeItem, removeItem, updateItem } from '../domain/layoutOps';
import type { LayoutRecord } from '../domain/types';
import { selectIsDirty, useEditor } from './editorStore';
import { saveCurrentLayout } from './saveLayout';

let repo: DemoRepository;

async function newLayout(kind: 'template' | 'event' = 'template'): Promise<LayoutRecord> {
  let data = createEmptyLayoutData();
  data = addItem(data, makeItem({ kind: 'stand_2chairs', instrumentId: 'demo-violin', partId: 'demo-vn1' }, 300, 300, 45));
  data = addItem(data, makeItem({ kind: 'bench', instrumentId: 'demo-perc', partId: null }, 800, 200, 90));
  return repo.createLayout({ teamId: 'demo-team', kind, name: '테스트 배치', eventDate: null, data });
}

beforeEach(() => {
  repo = new DemoRepository(false);
  repo.latencyMs = 0;
  useEditor.getState().reset();
});

describe('실행 취소 / 다시 실행', () => {
  it('추가·이동·삭제를 되돌리고 다시 실행한다', async () => {
    useEditor.getState().load(await newLayout());
    const ed = () => useEditor.getState();
    const first = ed().data.items[0];

    ed().commit((d) => addItem(d, makeItem({ kind: 'chair_only', instrumentId: null, partId: null }, 10, 10)));
    expect(ed().data.items).toHaveLength(3);

    // 드래그 동작은 끝났을 때 한 번만 기록된다
    ed().beginGesture();
    for (let i = 0; i < 10; i++) ed().updateTransient((d) => updateItem(d, first.id, { x: first.x + i * 5 }));
    ed().endGesture();
    expect(ed().past).toHaveLength(2);

    ed().commit((d) => removeItem(d, first.id));
    expect(ed().data.items).toHaveLength(2);

    ed().undo();
    expect(ed().data.items.find((i) => i.id === first.id)?.x).toBe(first.x + 45);
    ed().undo();
    expect(ed().data.items.find((i) => i.id === first.id)?.x).toBe(first.x);
    ed().undo();
    expect(ed().data.items).toHaveLength(2);
    expect(selectIsDirty(ed())).toBe(false);

    ed().redo();
    ed().redo();
    ed().redo();
    expect(ed().data.items).toHaveLength(2);
    expect(ed().data.items.some((i) => i.id === first.id)).toBe(false);
    expect(selectIsDirty(ed())).toBe(true);
  });

  it('움직이지 않은 동작은 기록하지 않는다', async () => {
    useEditor.getState().load(await newLayout());
    useEditor.getState().beginGesture();
    useEditor.getState().endGesture();
    expect(useEditor.getState().past).toHaveLength(0);
  });
});

describe('저장과 불러오기', () => {
  it('다른 배치를 연 뒤 도착한 이전 저장 응답은 새 배치 상태를 바꾸지 않는다', async () => {
    const first = await newLayout();
    const second = await newLayout();
    useEditor.getState().load(first);
    useEditor.getState().setMeta({ name: '첫 배치 변경' });
    let finish!: () => void;
    const delayed: Repository = Object.create(repo);
    delayed.saveLayout = async (...args) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return repo.saveLayout(...args);
    };
    const pending = saveCurrentLayout(delayed);
    useEditor.getState().load(second);
    finish();
    expect(await pending).toBe('skipped');
    expect(useEditor.getState().meta?.id).toBe(second.id);
    expect(useEditor.getState().meta?.version).toBe(1);
    expect(selectIsDirty(useEditor.getState())).toBe(false);
  });

  it('저장 중 계속 편집한 변경은 저장 완료 후에도 미저장 상태로 남는다', async () => {
    useEditor.getState().load(await newLayout());
    useEditor.getState().setMeta({ name: '저장 시점' });
    let finish!: () => void;
    const delayed: Repository = Object.create(repo);
    delayed.saveLayout = async (...args) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return repo.saveLayout(...args);
    };
    const pending = saveCurrentLayout(delayed);
    useEditor.getState().setMeta({ name: '저장 중 추가 변경' });
    finish();
    expect(await pending).toBe('saved');
    expect(useEditor.getState().meta?.name).toBe('저장 중 추가 변경');
    expect(selectIsDirty(useEditor.getState())).toBe(true);
  });

  it('저장 후 다시 불러오면 위치·방향·악기·파트·장의자 길이가 복원된다', async () => {
    const rec = await newLayout();
    useEditor.getState().load(rec);
    const ed = () => useEditor.getState();
    const [a, b] = ed().data.items;
    ed().commit((d) => updateItem(d, a.id, { x: 512, y: 384, rotation: 300, instrumentId: 'demo-violin', partId: 'demo-vn2' }));
    ed().commit((d) => updateItem(d, b.id, { benchLength: 420 }));
    ed().setMeta({ name: '12월 연주회', eventDate: '2026-12-19', kind: 'event' });
    expect(selectIsDirty(ed())).toBe(true);

    expect(await saveCurrentLayout(repo)).toBe('saved');
    expect(selectIsDirty(ed())).toBe(false);
    expect(ed().meta?.version).toBe(2);

    const loaded = await repo.getLayout(rec.id);
    expect(loaded?.name).toBe('12월 연주회');
    expect(loaded?.eventDate).toBe('2026-12-19');
    expect(loaded?.kind).toBe('event');
    const la = loaded!.data.items.find((i) => i.id === a.id)!;
    expect(la).toMatchObject({ x: 512, y: 384, rotation: 300, instrumentId: 'demo-violin', partId: 'demo-vn2', kind: 'stand_2chairs' });
    expect(loaded!.data.items.find((i) => i.id === b.id)!.benchLength).toBe(420);
  });

  it('이름이 비어 있으면 저장하지 않고 오류를 보여 주며 작업 내용은 유지한다', async () => {
    useEditor.getState().load(await newLayout());
    useEditor.getState().setMeta({ name: '   ' });
    expect(await saveCurrentLayout(repo)).toBe('invalid');
    expect(useEditor.getState().saveStatus).toBe('error');
    expect(useEditor.getState().data.items).toHaveLength(2);
  });

  it('네트워크 오류로 저장에 실패해도 화면의 작업 내용이 유지되고 재시도할 수 있다', async () => {
    useEditor.getState().load(await newLayout());
    useEditor.getState().commit((d) => addItem(d, makeItem({ kind: 'stand_only', instrumentId: null, partId: null }, 0, 0)));
    const failing: Repository = Object.create(repo);
    failing.saveLayout = async () => ({ ok: false, reason: 'error', message: 'Failed to fetch' });
    expect(await saveCurrentLayout(failing)).toBe('error');
    const s = useEditor.getState();
    expect(s.saveStatus).toBe('error');
    expect(s.saveError).toMatch(/인터넷 연결/);
    expect(s.data.items).toHaveLength(3);
    expect(selectIsDirty(s)).toBe(true);

    expect(await saveCurrentLayout(repo)).toBe('saved');
    expect((await repo.getLayout(s.meta!.id))!.data.items).toHaveLength(3);
  });
});

describe('저장 충돌 감지', () => {
  it('다른 사람이 먼저 저장했으면 덮어쓰지 않고 충돌로 안내한다', async () => {
    const rec = await newLayout();
    useEditor.getState().load(rec);
    useEditor.getState().commit((d) => addItem(d, makeItem({ kind: 'chair_only', instrumentId: null, partId: null }, 5, 5)));

    // 다른 사용자가 같은 배치를 먼저 저장
    const other = await repo.getLayout(rec.id);
    const otherSave = await repo.saveLayout(rec.id, other!.version, {
      kind: other!.kind,
      name: '다른 사람이 바꾼 이름',
      eventDate: null,
      data: other!.data,
    });
    expect(otherSave.ok).toBe(true);

    expect(await saveCurrentLayout(repo)).toBe('conflict');
    const s = useEditor.getState();
    expect(s.saveStatus).toBe('conflict');
    expect(s.conflict?.version).toBe(2);
    expect(s.data.items).toHaveLength(3); // 내 작업 유지
    const server = await repo.getLayout(rec.id);
    expect(server?.name).toBe('다른 사람이 바꾼 이름'); // 조용히 덮어쓰지 않음
    expect(server?.data.items).toHaveLength(2);

    // 사용자가 명시적으로 덮어쓰기를 선택한 경우에만 저장
    expect(await saveCurrentLayout(repo, { force: true })).toBe('saved');
    const after = await repo.getLayout(rec.id);
    expect(after?.data.items).toHaveLength(3);
    expect(after?.version).toBe(3);
  });

  it('조건부 저장 결과 해석: 충돌 / 삭제됨 / 권한 없음', () => {
    const latest = { version: 5 } as LayoutRecord;
    expect(interpretSaveOutcome(null, latest, 4)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(interpretSaveOutcome(null, null, 4)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(interpretSaveOutcome(null, latest, 5)).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(interpretSaveOutcome(latest, null, 4)).toMatchObject({ ok: true });
  });

  it('열람자의 저장 요청은 거부된다', async () => {
    const rec = await newLayout();
    repo.setRole('viewer');
    useEditor.getState().load(rec);
    useEditor.getState().setMeta({ name: '변조' });
    expect(await saveCurrentLayout(repo)).toBe('error');
    expect(useEditor.getState().saveError).toMatch(/권한/);
    expect((await repo.getLayout(rec.id))?.name).toBe('테스트 배치');
    await expect(
      repo.createLayout({ teamId: 'demo-team', kind: 'event', name: 'x', eventDate: null, data: createEmptyLayoutData() }),
    ).rejects.toThrow(/권한/);
  });
});

describe('템플릿과 일정의 독립 저장', () => {
  it('템플릿으로 만든 일정을 수정·저장해도 템플릿과 다른 일정은 바뀌지 않는다', async () => {
    const tpl = await newLayout('template');
    const e1 = await repo.createLayout({ teamId: 'demo-team', kind: 'event', name: '일정1', eventDate: '2026-11-01', data: cloneLayoutData(tpl.data), sourceLayoutId: tpl.id });
    const e2 = await repo.createLayout({ teamId: 'demo-team', kind: 'event', name: '일정2', eventDate: '2026-11-08', data: cloneLayoutData(tpl.data), sourceLayoutId: tpl.id });

    useEditor.getState().load(e1);
    const target = useEditor.getState().data.items[0];
    useEditor.getState().commit((d) => updateItem(d, target.id, { x: 1, y: 2, rotation: 180 }));
    useEditor.getState().commit((d) => addItem(d, makeItem({ kind: 'stand_only', instrumentId: null, partId: null }, 0, 0)));
    expect(await saveCurrentLayout(repo)).toBe('saved');

    const tplAfter = await repo.getLayout(tpl.id);
    const e2After = await repo.getLayout(e2.id);
    expect(tplAfter!.data).toEqual(tpl.data);
    expect(tplAfter!.version).toBe(1);
    expect(e2After!.data).toEqual(e2.data);
    expect((await repo.getLayout(e1.id))!.data.items).toHaveLength(3);
  });
});

describe('기본 악기 목록', () => {
  it('데모용 목록과 Supabase seed SQL 의 악기 이름이 같다', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '20261025000000_init.sql'), 'utf8');
    const seedFn = sql.slice(sql.indexOf('function public.seed_default_instruments'), sql.indexOf('function public.admin_create_team'));
    for (const s of DEFAULT_INSTRUMENT_SEEDS) {
      expect(seedFn, s.name).toContain(`'${s.name}'`);
      for (const p of s.parts ?? []) expect(seedFn, p.name).toContain(`'${p.name}'`);
    }
  });
});
