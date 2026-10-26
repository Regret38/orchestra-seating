import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { friendlyError } from '../data/repository';
import { cloneLayoutData, createEmptyLayoutData } from '../domain/layoutOps';
import { canDeleteLayout, canEdit, type LayoutKind, type LayoutRecord, type LayoutSummary } from '../domain/types';
import { formatDate, formatDateTime, Modal, Spinner } from './ui';

interface Props { onClose(): void; onOpen(r: LayoutRecord): void; canLeave(): boolean; onImport(): void; currentId: string | null; onDeleteCurrent(): void }
export function LibraryDialog({ onClose, onOpen, canLeave, onImport, currentId, onDeleteCurrent }: Props) {
  const { repo, team, role, user, isDemo } = useApp();
  const [rows, setRows] = useState<LayoutSummary[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [name, setName] = useState(''); const [kind, setKind] = useState<LayoutKind>('event'); const [date, setDate] = useState('');
  const [filter, setFilter] = useState('');
  async function refresh() { setLoading(true); try { setRows((await repo.listLayouts(team!.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, [team?.id]);
  async function task(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } }
  async function create(e: FormEvent) {
    e.preventDefault(); if (!canLeave()) return;
    await task(async () => { const r = await repo.createLayout({ teamId: team!.id, kind, name: name.trim(), eventDate: date || null, data: createEmptyLayoutData() }); onOpen(r); });
  }
  return <Modal title="배치 라이브러리" onClose={busy ? undefined : onClose} wide>
    {canEdit(role) && <form className="new-layout-form" onSubmit={e => void create(e)}><h3>새 배치 만들기</h3><div className="form-grid"><label>이름<input aria-label="새 배치 이름" required maxLength={100} value={name} placeholder="예: 11월 첫째 주 연습" onChange={e => setName(e.target.value)}/></label><label>종류<select aria-label="새 배치 종류" value={kind} onChange={e => setKind(e.target.value as LayoutKind)}><option value="event">일정</option><option value="template">기본 배치 템플릿</option></select></label><label>날짜<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label></div><div className="button-row"><button className="primary" disabled={busy || !name.trim()}>빈 무대로 만들기</button><button type="button" disabled={busy} onClick={onImport}>JSON 가져오기</button></div></form>}
    {error && <p className="message error" role="alert">{error}<button onClick={() => void refresh()}>다시 불러오기</button></p>}
    <div className="library-heading"><h3>저장된 배치 <span className="muted">{rows.length}</span></h3><input aria-label="배치 검색" placeholder="이름으로 검색" value={filter} onChange={e => setFilter(e.target.value)}/></div>
    {loading ? <Spinner/> : <div className="layout-list">{rows.filter(r => r.name.includes(filter)).map(r => <article className="layout-card" key={r.id}><div><span className={`badge ${r.kind}`}>{r.kind === 'template' ? '기본 배치' : '일정'}</span><h3>{r.name}</h3><p>{formatDate(r.eventDate)} · {r.itemCount}세트</p><small className="muted">{isDemo ? '메모리 저장' : '수정'} {formatDateTime(r.updatedAt)}</small></div><div className="button-row"><button className="primary" disabled={busy} onClick={() => { if (canLeave()) void task(async () => { const rec = await repo.getLayout(r.id); if (!rec) throw new Error('배치가 삭제되었거나 접근 권한이 없습니다.'); onOpen(rec); }); }}>열기</button>{canEdit(role) && <button disabled={busy} onClick={() => {
      if (!canLeave()) return;
      const copyName = window.prompt('복사할 새 일정 이름', `${r.name} 사본`);
      if (!copyName?.trim()) return;
      if (copyName.trim().length > 100) { setError('이름은 100자 이하여야 합니다.'); return; }
      void task(async () => { const src = await repo.getLayout(r.id); if (!src) throw new Error('원본 배치를 찾을 수 없습니다.'); const copy = await repo.createLayout({ teamId: team!.id, kind: 'event', name: copyName.trim(), eventDate: null, data: cloneLayoutData(src.data), sourceLayoutId: src.id }); onOpen(copy); });
    }}>새 일정으로 복사</button>}{canDeleteLayout(role, r, user?.id) && <button className="danger" disabled={busy} onClick={() => { if (r.id === currentId && !canLeave()) return; if (!window.confirm(`“${r.name}” 배치를 삭제할까요?`)) return; void task(async () => { await repo.deleteLayout(r.id); if (r.id === currentId) onDeleteCurrent(); await refresh(); }); }}>삭제</button>}</div></article>)}{!rows.length && <p className="empty-selection">저장된 배치가 없습니다. 새 배치를 만들어 주세요.</p>}</div>}
  </Modal>;
}
