import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Modal dialog on the native <dialog> element: the browser provides focus containment, Escape
 * handling and an inert background, which a hand-rolled overlay would have to imitate.
 */
export function Dialog({
  title,
  children,
  actions,
  onClose,
  tone = 'default',
}: {
  title: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${tone}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
