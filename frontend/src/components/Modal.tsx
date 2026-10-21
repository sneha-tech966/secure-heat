import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; ref.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', h);
    return () => { document.removeEventListener('keydown', h); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/80 p-4 pt-[8vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-2xl outline-none`}>
        <header className="flex items-center justify-between border-b border-edge px-4 py-3"><h2 className="text-base font-semibold text-slate-100">{title}</h2><button aria-label="Close" className="rounded px-2 text-slate-400 hover:bg-navy-600 hover:text-white" onClick={onClose}>✕</button></header>
        <div className="px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-edge px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmation for sensitive operations. With `reasonLabel` a reason (min 3 chars) is required before confirming. */
export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger, reasonLabel, busy, onConfirm, onClose }:
  { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; reasonLabel?: string; busy?: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState(''); const needsReason = Boolean(reasonLabel); const ok = !needsReason || reason.trim().length >= 3;
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className={danger ? 'btn-danger' : 'btn-primary'} disabled={!ok || busy} onClick={() => onConfirm(reason.trim())}>{busy ? 'Working…' : confirmLabel}</button></>}>
      <div className="text-sm text-slate-300">{message}</div>
      {needsReason && (<div className="mt-4"><label className="label" htmlFor="confirm-reason">{reasonLabel}</label><textarea id="confirm-reason" className="input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>)}
    </Modal>
  );
}
