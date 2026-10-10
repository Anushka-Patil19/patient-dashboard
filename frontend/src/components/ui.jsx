import { useEffect, useId, useRef } from 'react';

export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {typeof children === 'function' ? children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy }) : children}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const ALERT_TONES = {
  error: 'border-danger/40 bg-danger-wash text-ink',
  warn: 'border-warn-ink/30 bg-warn-wash text-ink',
  info: 'border-accent/30 bg-accent-wash text-ink',
  success: 'border-good/30 bg-good-wash text-ink',
};
const ALERT_ICONS = { error: '!', warn: '!', info: 'i', success: '✓' };

export function Alert({ tone = 'info', title, children, action }) {
  return (
    <div className={`flex gap-3 rounded-lg border px-3.5 py-3 text-sm ${ALERT_TONES[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span
        aria-hidden
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${
          tone === 'error' ? 'bg-danger' : tone === 'success' ? 'bg-good' : tone === 'warn' ? 'bg-warn-ink' : 'bg-accent'
        }`}
      >
        {ALERT_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-wash text-accent-ink',
    danger: 'bg-danger-wash text-danger',
    good: 'bg-good-wash text-good',
    warn: 'bg-warn-wash text-warn-ink',
  };
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ title, children }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-sm text-muted">
      <span className="tabular">
        {from}–{to} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex gap-1">
        <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, dismissable = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose?.();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50"
    >
      {open && (
        <div>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorAlert({ error, onRetry }) {
  if (!error) return null;
  return (
    <Alert
      tone="error"
      title={error.status === 403 ? 'Access denied' : 'Could not load data'}
      action={onRetry && error.status !== 403 ? <button className="btn-secondary" onClick={onRetry}>Retry</button> : null}
    >
      {error.message}
    </Alert>
  );
}
