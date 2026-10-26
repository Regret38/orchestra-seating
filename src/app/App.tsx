import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { config } from '../config';
import { useApp } from './AppContext';
import { canEdit, ROLE_LABELS, SET_KINDS, type LayoutKind, type LayoutRecord, type SetKind, type StageItem } from '../domain/types';
import { friendlyError } from '../data/repository';
import { addItem, cloneLayoutData, duplicateItem, makeItem, removeItem, setSpares, updateItem } from '../domain/layoutOps';
import { computeCounts } from '../domain/counting';
import { findSpawnPosition } from '../domain/placement';
import { snapshotLabel } from '../domain/labels';
import { BENCH_MAX_LENGTH, BENCH_MIN_LENGTH, SET_DEFINITIONS } from '../domain/sets';
import { buildExportFile, MAX_IMPORT_BYTES, parseImportFile, remapToCatalog } from '../domain/validation';
import { selectIsDirty, useEditor, usePrefs } from '../state/editorStore';
import { useView } from '../state/viewStore';
import { saveCurrentLayout } from '../state/saveLayout';
import { StageCanvas } from '../components/stage/StageCanvas';
import { StaticStage, type StaticStageHandle } from '../components/stage/StaticStage';
import { downloadFile, formatDate, formatDateTime, Icon, Modal, safeFileName, SetKindIcon, Spinner } from '../components/ui';
import { LibraryDialog } from '../components/LibraryDialog';
import { AdminDialog } from '../components/AdminDialog';

export function App() {
  const app = useApp();
  const ed = useEditor();
  const prefs = usePrefs();
  const dirty = useEditor(selectIsDirty);
  const [library, setLibrary] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [output, setOutput] = useState(false);
  const [panel, setPanel] = useState<'counts' | 'selection'>('counts');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [initialError, setInitialError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const printStage = useRef<StaticStageHandle>(null);
  const [printImage, setPrintImage] = useState('');
  const editable = canEdit(app.role);
  const counts = useMemo(() => computeCounts(ed.data.items, ed.data.spares, app.catalog), [ed.data, app.catalog]);
  const selected = ed.data.items.find(i => i.id === ed.selectedId);
  const saving = ed.saveStatus === 'saving';

  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (selectIsDirty(useEditor.getState())) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  useEffect(() => {
    let alive = true;
    useEditor.getState().reset();
    setInitialError(''); setLibrary(false); setAdmin(false);
    if (!app.team) return;
    app.repo.listLayouts(app.team.id).then(async layouts => {
      const first = layouts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const rec = first ? await app.repo.getLayout(first.id) : null;
      if (!alive) return;
      if (rec) loadRecord(rec); else setLibrary(true);
    }).catch(e => alive && setInitialError(friendlyError(e)));
    return () => { alive = false; };
  }, [app.team?.id, app.user?.id]);

  function loadRecord(rec: LayoutRecord) {
    useEditor.getState().load(rec);
    requestAnimationFrame(() => useView.getState().fitTo(rec.data.items, rec.data.stage));
  }

  function mayLeave() {
    if (saving || busy) return false;
    return !selectIsDirty(useEditor.getState()) || window.confirm('저장하지 않은 변경이 있습니다. 변경을 버리고 진행할까요? JSON 내보내기로 별도 보관할 수 있습니다.');
  }

  async function task(fn: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await fn(); } catch (e) { setNotice(friendlyError(e)); } finally { setBusy(false); }
  }

  async function save() { if (editable && !busy) await saveCurrentLayout(app.repo); }

  function patchSelected(patch: Partial<Omit<StageItem, 'id'>>) {
    if (!editable || !selected) return;
    ed.commit(d => updateItem(d, selected.id, patch));
  }

  function duplicate() {
    if (!editable || !selected || ed.data.items.length >= 2000) return;
    const result = duplicateItem(ed.data, selected.id);
    ed.commit(() => result.data, result.newId);
  }

  function add() {
    if (!editable || !ed.meta || ed.data.items.length >= 2000) return;
    const inst = app.catalog.instruments.get(prefs.addInstrumentId ?? '');
    const partId = inst?.parts.find(p => p.id === prefs.addPartId)?.id ?? null;
    const pos = findSpawnPosition(ed.data.items, prefs.addKind, useView.getState().visibleRect(), ed.data.stage);
    const item = makeItem({ kind: prefs.addKind, instrumentId: inst?.id ?? null, partId, customLabel: prefs.addCustomLabel }, pos.x, pos.y);
    item.labelSnapshot = snapshotLabel(item, app.catalog);
    ed.commit(d => addItem(d, item), item.id); setPanel('selection');
  }

  function exportJSON() {
    if (!ed.meta) return;
    const data = { ...ed.data, items: ed.data.items.map(i => ({ ...i, labelSnapshot: snapshotLabel(i, app.catalog) })) };
    downloadFile(`${safeFileName(ed.meta.name)}.json`, JSON.stringify(buildExportFile({ name: ed.meta.name, kind: ed.meta.kind, eventDate: ed.meta.eventDate, data }), null, 2));
  }

  async function importJSON(file: File) {
    if (!app.team || !editable) return;
    if (file.size > MAX_IMPORT_BYTES) { setNotice('파일은 최대 2MB까지 가져올 수 있습니다.'); return; }
    if (!mayLeave()) return;
    await task(async () => {
      const result = parseImportFile(await file.text());
      if (!result.ok) throw new Error(result.errors.join('\n'));
      const v = result.value;
      const record = await app.repo.createLayout({ teamId: app.team!.id, name: v.name, kind: v.kind, eventDate: v.eventDate, data: cloneLayoutData(remapToCatalog(v.data, app.catalog)) });
      loadRecord(record); setLibrary(false); setNotice('파일을 새 배치로 가져왔습니다.');
    });
  }

  async function copyAs(kind: LayoutKind) {
    if (!app.team || !ed.meta || !editable || saving) return;
    const name = window.prompt(kind === 'template' ? '템플릿 이름' : '새 일정 이름', `${ed.meta.name} ${kind === 'template' ? '기본 배치' : '사본'}`);
    if (!name?.trim()) return;
    if (name.trim().length > 100) { setNotice('이름은 100자 이하여야 합니다.'); return; }
    await task(async () => {
      const r = await app.repo.createLayout({ teamId: app.team!.id, name: name.trim(), kind, eventDate: kind === 'event' ? ed.meta!.eventDate : null, data: cloneLayoutData(ed.data), sourceLayoutId: ed.meta!.id });
      loadRecord(r); setNotice(app.isDemo ? '메모리에 사본을 만들었습니다. JSON으로 백업하세요.' : '새 배치로 저장했습니다.');
    });
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable], [role="dialog"]')) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
        if (editable && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); }
      }
      if (editable && selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); ed.commit(d => removeItem(d, selected.id), null); }
      if (e.key === 'Escape') ed.select(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function makePrintImage() {
    const url = printStage.current?.toDataURL(2);
    if (url) setPrintImage(url);
  }

  if (config.secretKeyMisconfigured) return <main className="auth-card"><h1>연결 설정을 확인해 주세요</h1><p>공개 키 대신 비밀키가 입력되었습니다. 해당 키를 폐기·교체하고 publishable 키로 다시 빌드하세요.</p></main>;
  if (app.user === undefined) return <Spinner label="무대노트를 여는 중…"/>;
  if (!app.user) return <AuthScreen/>;
  if (!app.memberships) return <Spinner label="팀을 확인하는 중…"/>;
  if (!app.team) return <main className="auth-card"><Brand/><h1>팀 초대를 기다리고 있어요</h1><p>로그인만으로는 팀 데이터에 접근할 수 없습니다. 관리자에게 <strong>{app.user.email}</strong> 계정 초대를 요청해 주세요.</p>{app.teamsError && <p role="alert">{app.teamsError}</p>}{app.invitations.map(i => <div className="invitation" key={i.id}><strong>{i.teamName || '초대된 팀'}</strong><span>{ROLE_LABELS[i.role]}</span><button disabled={busy} onClick={() => void task(async () => { await app.repo.acceptInvitation(i.id); await app.refreshTeams(); })}>초대 수락</button><button disabled={busy} onClick={() => void task(async () => { await app.repo.declineInvitation(i.id); await app.refreshTeams(); })}>거절</button></div>)}<p role="status">{notice}</p><button disabled={busy} onClick={() => void app.refreshTeams()}>초대 새로고침</button><button onClick={() => void app.repo.signOut()}>로그아웃</button></main>;

  return <div className="app-shell">
    <header className="app-header">
      <Brand/>
      <div className="header-team"><select aria-label="팀 선택" value={app.team.id} disabled={busy || saving} onChange={e => { if (mayLeave()) app.setTeam(e.target.value); }}>{app.memberships.map(m => <option key={m.team.id} value={m.team.id}>{m.team.name}</option>)}</select><span className="role-tag">{ROLE_LABELS[app.role!]}</span></div>
      <div className="header-actions">{app.invitations.length > 0 && <button aria-label={`받은 초대 ${app.invitations.length}개`} onClick={() => setShowInvites(true)}><Icon name="users"/><span>받은 초대 {app.invitations.length}</span></button>}{app.role === 'admin' && <button onClick={() => setAdmin(true)}><Icon name="sliders"/>팀 설정</button>}<button title={app.user.email} onClick={() => { if (mayLeave()) void task(async () => { await app.repo.signOut(); useEditor.getState().reset(); }); }}><Icon name="logout"/><span>로그아웃</span></button></div>
    </header>
    {app.isDemo && <div className="demo-banner"><span><strong>데모 모드</strong> · 이 탭의 메모리에만 저장됩니다. 새로고침하면 초기화되니 JSON 파일로 보관하세요.</span><select aria-label="데모 권한" value={app.role!} disabled={busy || saving} onChange={e => void app.setDemoRole(e.target.value as 'admin' | 'editor' | 'viewer')}><option value="admin">관리자 체험</option><option value="editor">편집자 체험</option><option value="viewer">열람자 체험</option></select></div>}
    <section className="document-bar">
      <div className="document-heading"><span className="eyebrow">ORCHESTRA STAGE PLANNER</span><h1>{ed.meta?.name || '우리의 다음 무대를 준비하세요'}</h1><p>{ed.meta ? `${ed.meta.kind === 'template' ? '기본 배치 템플릿' : formatDate(ed.meta.eventDate)} · ${ed.data.items.length}세트` : '기본 배치를 만들고 일정마다 복사해 사용하세요.'}</p></div>
      <div className="document-actions"><button disabled={busy || saving} onClick={() => setLibrary(true)}><Icon name="list"/>배치 목록</button><button disabled={!ed.meta} onClick={() => setOutput(true)}><Icon name="print"/>출력·내보내기</button>{editable && <button className="primary" disabled={!ed.meta || busy || saving || !dirty} onClick={() => void save()}><Icon name="save"/>{saving ? '저장 중…' : app.isDemo ? '메모리에 저장' : '저장'}</button>}</div>
    </section>
    {(notice || initialError || app.catalogError) && <div className="message" role="status">{notice || initialError || app.catalogError}<button aria-label="알림 닫기" onClick={() => { setNotice(''); setInitialError(''); }}>×</button></div>}
    {ed.saveError && <div className="message error" role="alert">{ed.saveError}<button disabled={!editable || saving} onClick={() => void save()}>다시 저장</button><button disabled={!editable || saving} onClick={() => void copyAs('event')}>새 배치로 저장</button></div>}
    {ed.conflict && <div className="message error" role="alert"><span>다른 담당자가 먼저 저장했습니다. 내 작업은 유지되어 있습니다.</span><button onClick={exportJSON}>내 작업 JSON 보관</button><button onClick={() => { if (window.confirm('내 변경을 버리고 서버의 최신 배치를 불러올까요?')) loadRecord(ed.conflict!); }}>최신 배치 불러오기</button><button disabled={!editable || saving} onClick={() => { if (window.confirm('다른 담당자의 변경을 현재 내용으로 덮어쓸까요?')) void saveCurrentLayout(app.repo, { force: true }); }}>현재 내용으로 덮어쓰기</button></div>}
    {ed.meta ? <>
      <section className="add-toolbar" aria-label="세트 추가 도구">
        <div className="set-picker">{SET_KINDS.map(kind => <button key={kind} className={`set-button ${prefs.addKind === kind ? 'active' : ''}`} aria-pressed={prefs.addKind === kind} onClick={() => prefs.set({ addKind: kind })}><SetKindIcon kind={kind} size={34}/><span>{SET_DEFINITIONS[kind].shortLabel}</span></button>)}</div>
        <div className="add-fields"><InstrumentFields instrumentId={prefs.addInstrumentId} partId={prefs.addPartId} customLabel={prefs.addCustomLabel} onChange={v => prefs.set({ addInstrumentId: v.instrumentId, addPartId: v.partId, addCustomLabel: v.customLabel ?? '' })}/><button className="primary add-button" disabled={!editable || app.catalogLoading || ed.data.items.length >= 2000} onClick={add}><Icon name="plus"/>무대에 추가</button></div>
      </section>
      <div className="workspace">
        <section className="stage-workspace">
          <div className="canvas-tools"><div><button aria-label="실행 취소" disabled={!editable || !ed.past.length} onClick={ed.undo}><Icon name="undo"/></button><button aria-label="다시 실행" disabled={!editable || !ed.future.length} onClick={ed.redo}><Icon name="redo"/></button><span className="tool-divider"/><label><input type="checkbox" checked={prefs.showGrid} onChange={e => prefs.set({ showGrid: e.target.checked })}/>격자</label><label><input type="checkbox" checked={prefs.snap} onChange={e => prefs.set({ snap: e.target.checked })}/>맞춤</label></div><div><button aria-label="축소" onClick={() => useView.getState().zoomBy(0.8)}>−</button><button aria-label="확대" onClick={() => useView.getState().zoomBy(1.25)}>＋</button><button onClick={() => useView.getState().fitTo(ed.data.items, ed.data.stage)}><Icon name="target"/>전체 보기</button></div></div>
          <StageCanvas data={ed.data} catalog={app.catalog} selectedId={ed.selectedId} editable={editable} showGrid={prefs.showGrid} snap={prefs.snap} onSelect={id => { ed.select(id); if (id) setPanel('selection'); }} onMoveEnd={(id, x, y) => { if (editable) ed.commit(d => updateItem(d, id, { x, y })); }} onRotateStart={() => { if (editable) ed.beginGesture(); }} onRotate={(id, rotation) => { if (editable) ed.updateTransient(d => updateItem(d, id, { rotation })); }} onRotateEnd={() => ed.endGesture()}/>
          <footer className="canvas-footer"><span>세트 선택 후 이동 · 빈 공간을 끌어 화면 이동 · 두 손가락으로 확대</span><span>{!editable ? '열람 전용' : dirty ? '● 저장하지 않은 변경' : app.isDemo ? '메모리 기준 변경 없음' : '✓ 저장된 상태'}</span></footer>
        </section>
        <aside className="side-panel"><div className="tabs"><button className={panel === 'counts' ? 'active' : ''} onClick={() => setPanel('counts')}>준비 수량</button><button className={panel === 'selection' ? 'active' : ''} onClick={() => setPanel('selection')}>선택한 세트</button></div>
          {panel === 'counts' ? <><CountCards counts={counts}/><div className="panel-body"><h3>예비 물품</h3><p className="muted">무대에 배치하지 않고 준비 수량에만 더해요.</p><div className="spare-fields">{(['stands', 'chairs', 'benches'] as const).map((key, i) => <label key={key}>{['보면대', '의자', '장의자'][i]}<input aria-label={`예비 ${['보면대', '의자', '장의자'][i]}`} type="number" min="0" max="9999" value={ed.data.spares[key]} disabled={!editable} onChange={e => ed.commit(d => setSpares(d, { [key]: Number(e.target.value) }))}/></label>)}</div><h3>악기·파트별 배치</h3><GroupTable counts={counts}/><details><summary>세트별 개수</summary>{SET_KINDS.map(k => <div className="count-row" key={k}><span>{SET_DEFINITIONS[k].label}</span><strong>{counts.bySetKind[k]}</strong></div>)}</details></div></> : <div className="panel-body">{selected ? <><p className="eyebrow">SELECTED SET</p><h2>{SET_DEFINITIONS[selected.kind].label}</h2><fieldset disabled={!editable}><label>세트 구성<select aria-label="선택한 세트 구성" value={selected.kind} onChange={e => patchSelected({ kind: e.target.value as SetKind })}>{SET_KINDS.map(k => <option key={k} value={k}>{SET_DEFINITIONS[k].label}</option>)}</select></label><InstrumentFields instrumentId={selected.instrumentId} partId={selected.partId} customLabel={selected.customLabel ?? ''} onChange={v => { const next = { ...selected, ...v }; patchSelected({ ...v, labelSnapshot: snapshotLabel(next, app.catalog) }); }}/><div className="two-fields"><label>X 위치<input aria-label="세트 X 위치" type="number" min="-20000" max="20000" value={selected.x} onChange={e => patchSelected({ x: Math.max(-20000, Math.min(20000, Number(e.target.value))) })}/></label><label>Y 위치<input aria-label="세트 Y 위치" type="number" min="-20000" max="20000" value={selected.y} onChange={e => patchSelected({ y: Math.max(-20000, Math.min(20000, Number(e.target.value))) })}/></label></div><label>회전 각도<input aria-label="회전 각도" type="number" value={selected.rotation} onChange={e => patchSelected({ rotation: Number(e.target.value) })}/></label><div className="button-row"><button onClick={() => patchSelected({ rotation: selected.rotation - 15 })}>↶ 15°</button><button onClick={() => patchSelected({ rotation: selected.rotation + 15 })}>↷ 15°</button></div>{selected.kind === 'bench' && <label>장의자 길이 (안내도 단위)<input aria-label="장의자 길이" type="number" min={BENCH_MIN_LENGTH} max={BENCH_MAX_LENGTH} value={selected.benchLength ?? 150} onChange={e => patchSelected({ benchLength: Number(e.target.value) })}/></label>}<div className="button-row"><button onClick={duplicate}><Icon name="copy"/>복제</button><button className="danger" onClick={() => ed.commit(d => removeItem(d, selected.id), null)}><Icon name="trash"/>삭제</button></div></fieldset></> : <div className="empty-selection"><Icon name="target" size={32}/><h3>무대의 세트를 선택하세요</h3><p>악기와 구성, 위치, 방향을 수정할 수 있어요.</p></div>}</div>}
          <div className="document-settings"><details><summary>배치 정보</summary><fieldset disabled={!editable}><label>배치 이름<input aria-label="배치 이름" maxLength={100} value={ed.meta.name} onChange={e => ed.setMeta({ name: e.target.value })}/></label><label>날짜<input aria-label="배치 날짜" type="date" value={ed.meta.eventDate ?? ''} onChange={e => ed.setMeta({ eventDate: e.target.value || null })}/></label><label>종류<select value={ed.meta.kind} onChange={e => ed.setMeta({ kind: e.target.value as LayoutKind })}><option value="event">일정</option><option value="template">기본 배치 템플릿</option></select></label><button disabled={saving || busy} onClick={() => void copyAs('template')}>현재 배치를 새 템플릿으로 저장</button><button disabled={saving || busy} onClick={() => void copyAs('event')}>현재 배치를 새 일정으로 복사</button></fieldset><p className="muted">{app.isDemo ? '메모리 저장' : '마지막 저장'}: {formatDateTime(ed.lastSavedAt)}</p></details></div>
        </aside>
      </div>
    </> : <div className="welcome"><Icon name="plus" size={40}/><h2>첫 배치를 만들어 볼까요?</h2><p>빈 무대에서 시작하거나 JSON 파일을 가져올 수 있어요.</p><button className="primary" onClick={() => setLibrary(true)}>배치 목록 열기</button></div>}
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importJSON(f); }}/>
    {library && <LibraryDialog onClose={() => setLibrary(false)} onOpen={r => { loadRecord(r); setLibrary(false); }} canLeave={mayLeave} onImport={() => input.current?.click()} currentId={ed.meta?.id ?? null} onDeleteCurrent={() => ed.reset()}/>} 
    {admin && <AdminDialog onClose={() => setAdmin(false)}/>}
    {showInvites && <Modal title="받은 팀 초대" onClose={busy ? undefined : () => setShowInvites(false)}>{app.invitations.map(i => <div className="invitation" key={i.id}><strong>{i.teamName || '초대된 팀'}</strong><span>{ROLE_LABELS[i.role]}</span><button disabled={busy} onClick={() => { if (mayLeave()) void task(async () => { const id = await app.repo.acceptInvitation(i.id); await app.refreshTeams(); app.setTeam(id); setShowInvites(false); }); }}>초대 수락</button><button disabled={busy} onClick={() => void task(async () => { await app.repo.declineInvitation(i.id); await app.refreshTeams(); })}>거절</button></div>)}<p role="status">{notice}</p></Modal>}
    {output && ed.meta && <Modal title="배치도 출력·내보내기" onClose={() => setOutput(false)} wide><p className="muted">현재 화면의 변경 내용을 포함합니다. 출력물이 온라인 저장을 대신하지는 않습니다.</p><div className="button-row"><button onClick={exportJSON}>JSON 내보내기</button>{editable && <button onClick={() => { setOutput(false); input.current?.click(); }}>JSON 가져오기</button>}<button onClick={() => { const url = printStage.current?.toDataURL(2); if (url) { const a = document.createElement('a'); a.href = url; a.download = `${safeFileName(ed.meta!.name)}.png`; a.click(); } }}>PNG 이미지</button><button className="primary" onClick={() => { makePrintImage(); setTimeout(() => window.print(), 150); }}>인쇄 / PDF 저장</button></div><div className="output-preview"><StaticStage ref={printStage} data={ed.data} catalog={app.catalog} width={900}/></div><CountCards counts={counts}/></Modal>}
    <section className="print-sheet"><h1>{ed.meta?.name}</h1><p>{formatDate(ed.meta?.eventDate)} · {app.team.name} · 배치 안내도 (실제 축척 아님)</p>{printImage && <img src={printImage} alt="무대 배치도"/>}<h2>준비 물품</h2><CountCards counts={counts}/><GroupTable counts={counts}/><p>장의자는 일반 의자와 별도로 집계합니다. 최종 준비 수량에는 예비 물품이 포함됩니다.</p></section>
  </div>;
}

export function Brand() { return <div className="brand"><span className="brand-mark">♫</span><div><strong>무대노트</strong><small>STAGE NOTE</small></div></div>; }

export function InstrumentFields({ instrumentId, partId, customLabel, onChange }: { instrumentId: string | null; partId: string | null; customLabel: string; onChange(v: Pick<StageItem, 'instrumentId' | 'partId' | 'customLabel'>): void }) {
  const { instruments } = useApp();
  const inst = instruments.find(i => i.id === instrumentId);
  return <><label>악기<select aria-label="악기" value={inst?.id ?? ''} onChange={e => onChange({ instrumentId: e.target.value || null, partId: null, customLabel: '' })}><option value="">미지정/공용</option>{instruments.filter(i => i.isActive || i.id === instrumentId).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>{inst && !inst.allowCustom && inst.parts.length > 0 && <label>파트<select aria-label="파트" value={partId ?? ''} onChange={e => onChange({ instrumentId, partId: e.target.value || null, customLabel })}><option value="">파트 구분 없음</option>{inst.parts.filter(p => p.isActive || p.id === partId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}{inst?.allowCustom && <label>표시 이름<input aria-label="직접 입력 이름" maxLength={40} value={customLabel} placeholder="예: 하프" onChange={e => onChange({ instrumentId, partId: null, customLabel: e.target.value })}/></label>}</>;
}

export function CountCards({ counts }: { counts: ReturnType<typeof computeCounts> }) {
  return <div className="count-cards">{(['stands', 'chairs', 'benches'] as const).map((k, i) => <div key={k}><span>{['보면대', '일반 의자', '장의자'][i]}</span><strong data-testid={`total-${k}`}>{counts.total[k]}<small>개</small></strong><small>배치 {counts.placed[k]} + 예비 {counts.spares[k]}</small></div>)}</div>;
}

function GroupTable({ counts }: { counts: ReturnType<typeof computeCounts> }) { return <table className="group-table"><thead><tr><th>악기·파트</th><th>보면대</th><th>의자</th><th>장의자</th></tr></thead><tbody>{counts.byGroup.map(g => <tr key={g.key}><td><i style={{ background: g.color }}/>{g.label}</td><td>{g.stands}</td><td>{g.chairs}</td><td>{g.benches}</td></tr>)}{!counts.byGroup.length && <tr><td colSpan={4}>아직 배치한 세트가 없습니다.</td></tr>}</tbody></table>; }

function AuthScreen() {
  const { repo } = useApp();
  const [mode, setMode] = useState<'login' | 'signup' | 'link'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'login') await repo.signInWithPassword(email, password);
      else if (mode === 'signup') { const r = await repo.signUp(email, password); setMessage(r.needsEmailConfirm ? '인증 메일을 확인해 주세요. 인증 후 로그인하고 팀 초대를 수락하세요.' : '계정을 만들었습니다. 팀 초대를 확인하세요.'); }
      else { await repo.sendMagicLink(email); setMessage('로그인 링크를 보냈습니다. 이 브라우저에서 메일 링크를 열어 주세요.'); }
    } catch (err) { setMessage(friendlyError(err)); } finally { setBusy(false); }
  }
  return <main className="auth-layout"><section className="auth-intro"><Brand/><p className="eyebrow">A PLACE FOR EVERY PLAYER</p><h1>함께 만드는 무대,<br/>준비는 가볍게.</h1><p>의자 하나부터 오케스트라 전체까지.<br/>팀의 배치와 준비 수량을 한곳에 모으세요.</p></section><section className="auth-card"><h2>{mode === 'signup' ? '계정 만들기' : mode === 'link' ? '이메일 링크로 로그인' : '다시 만나 반가워요'}</h2><p className="muted">팀의 초대된 멤버만 배치에 접근할 수 있습니다.</p><form onSubmit={e => void submit(e)}><label>이메일<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></label>{mode !== 'link' && <label>비밀번호<input required type="password" minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)}/></label>}<button className="primary" disabled={busy}>{busy ? '처리 중…' : mode === 'signup' ? '계정 만들기' : mode === 'link' ? '로그인 링크 받기' : '로그인'}</button></form><p role="status">{message}</p><div className="button-row"><button disabled={busy} onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? '로그인으로 돌아가기' : '계정 만들기'}</button><button disabled={busy} onClick={() => setMode(mode === 'link' ? 'login' : 'link')}>{mode === 'link' ? '비밀번호로 로그인' : '이메일 링크로 로그인'}</button></div></section></main>;
}
