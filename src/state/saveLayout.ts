import { friendlyError, type Repository } from '../data/repository';
import { isValidDateString } from '../domain/validation';
import { useEditor } from './editorStore';

export type SaveOutcome = 'saved' | 'conflict' | 'error' | 'invalid' | 'skipped';

/** 저장 전 입력값 확인. 오류 문구(한국어) 또는 null */
export function validateMetaForSave(meta: { name: string; eventDate: string | null }): string | null {
  const name = meta.name.trim();
  if (!name) return '배치 이름을 입력하세요.';
  if (name.length > 100) return '배치 이름은 100자 이하로 입력하세요.';
  if (meta.eventDate && !isValidDateString(meta.eventDate)) return '날짜 형식이 올바르지 않습니다.';
  return null;
}

/**
 * 현재 편집 중인 배치를 저장한다.
 * - 화면의 작업 내용은 실패·충돌 시에도 그대로 유지된다.
 * - force=true 는 충돌 안내에서 사용자가 '덮어쓰기'를 명시적으로 고른 경우에만 사용한다.
 */
export async function saveCurrentLayout(repo: Repository, opts: { force?: boolean } = {}): Promise<SaveOutcome> {
  const s = useEditor.getState();
  if (!s.meta || s.saveStatus === 'saving') return 'skipped';

  const invalid = validateMetaForSave(s.meta);
  if (invalid) {
    s.markError(invalid);
    return 'invalid';
  }

  const expected = opts.force && s.conflict ? s.conflict.version : s.meta.version;
  const sent = {
    data: s.data,
    meta: { kind: s.meta.kind, name: s.meta.name.trim(), eventDate: s.meta.eventDate || null },
  };
  const requestId = s.meta.id;
  s.markSaving();
  try {
    const res = await repo.saveLayout(s.meta.id, expected, { ...sent.meta, data: sent.data });
    const st = useEditor.getState();
    // 저장 응답을 기다리는 동안 다른 배치를 연 경우 현재 편집기를 바꾸지 않는다.
    if (st.meta?.id !== requestId) return 'skipped';
    if (res.ok) {
      st.markSaved(res.record, sent);
      return 'saved';
    }
    switch (res.reason) {
      case 'conflict':
        st.markConflict(res.latest);
        return 'conflict';
      case 'not_found':
        st.markError('이 배치가 서버에서 삭제되었습니다. 메뉴의 "새 배치로 저장"으로 작업 내용을 보존하세요.');
        return 'error';
      case 'forbidden':
        st.markError('저장할 권한이 없습니다. 팀 관리자에게 편집 권한을 확인하세요.');
        return 'error';
      default:
        st.markError(friendlyError({ message: res.message }));
        return 'error';
    }
  } catch (e) {
    if (useEditor.getState().meta?.id !== requestId) return 'skipped';
    useEditor.getState().markError(friendlyError(e));
    return 'error';
  }
}
