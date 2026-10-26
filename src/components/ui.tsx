import { useEffect, useRef, type ReactNode } from 'react';
import type { SetKind } from '../domain/types';

// ---------------------------------------------------------------------
// 아이콘 (간단한 인라인 SVG)
// ---------------------------------------------------------------------
const paths: Record<string, ReactNode> = {
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  zoomIn: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-5-5M11 8v6M8 11h6" />,
  zoomOut: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-5-5M8 11h6" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  grid: <path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" />,
  magnet: <path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3zM6 7h4M14 7h4" />,
  rotL: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  rotR: <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />,
  copy: <path d="M9 9h11v11H9zM5 15H4V4h11v1" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  print: <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M4 4h16" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  back: <path d="M15 5l-7 7 7 7" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  target: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  users: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />,
  logout: <path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9" />,
  image: <path d="M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01" />,
  sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
};

export function Icon({ name, size = 20, title }: { name: keyof typeof paths | string; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className="icon"
    >
      {title && <title>{title}</title>}
      {paths[name] ?? null}
    </svg>
  );
}

/** 세트 종류 그림 (선택 버튼용) */
export function SetKindIcon({ kind, size = 40 }: { kind: SetKind; size?: number }) {
  const chair = (x: number, y: number) => (
    <g key={`${x},${y}`}>
      <rect x={x} y={y} width="12" height="12" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5" />
      <rect x={x} y={y} width="12" height="3" rx="1" fill="#2563eb" />
    </g>
  );
  const stand = (x: number, y: number) => <rect key={`s${x}`} x={x} y={y} width="16" height="3.5" rx="1" fill="#1e293b" />;
  let content: ReactNode;
  switch (kind) {
    case 'stand_2chairs':
      content = [chair(5, 6), chair(19, 6), stand(12, 23)];
      break;
    case 'stand_1chair':
      content = [chair(12, 6), stand(10, 23)];
      break;
    case 'stand_only':
      content = [stand(10, 15)];
      break;
    case 'chair_only':
      content = [chair(12, 10)];
      break;
    case 'bench':
      content = (
        <g>
          <rect x="3" y="10" width="30" height="12" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5" />
          <rect x="3" y="10" width="30" height="3" rx="1" fill="#2563eb" />
        </g>
      );
      break;
  }
  return (
    <svg width={size} height={(size * 32) / 36} viewBox="0 0 36 32" aria-hidden="true">
      {content}
    </svg>
  );
}

// ---------------------------------------------------------------------
// 모달
// ---------------------------------------------------------------------
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
      if (e.key === 'Tab') {
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter(n => n.getClientRects().length > 0);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (first && e.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (last && !e.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-header">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="닫기">
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 상태 화면
// ---------------------------------------------------------------------
export function Spinner({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-box state-error" role="alert">
      <p className="state-title">문제가 발생했습니다</p>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-box">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '날짜 없음';
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

export function downloadFile(filename: string, content: string | Blob, mime = 'application/json') {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'layout';
}
