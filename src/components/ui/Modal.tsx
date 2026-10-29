import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { confirmDiscard } from '../../store/dialogStore';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PANEL = 'bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4';

interface Props {
  onClose: () => void;
  /** Shown as the dialog's heading, and its accessible name. */
  title?: ReactNode;
  /** The accessible name, for a dialog that draws its own heading. */
  ariaLabel?: string;
  /** Classes for the heading, when it isn't the plain one. */
  titleClassName?: string;
  /** Unsaved edits: a click outside or Escape asks before closing. */
  dirty?: boolean;
  /** False while something is in flight: outside clicks and Escape do nothing. */
  dismissible?: boolean;
  /** Replaces the panel's classes. */
  className?: string;
  /** Stacking: the confirm dialog sits above every other dialog. */
  zClassName?: string;
  /** A close (×) button in the heading row. */
  showClose?: boolean;
  children: ReactNode;
}

/**
 * A dialog: labelled for screen readers, closes on Escape or a click
 * outside, keeps Tab inside itself, and hands focus back to whatever opened
 * it. Key presses stop here, so the player's shortcuts don't fire underneath.
 */
export function Modal({
  onClose, title, ariaLabel, titleClassName = 'text-lg font-semibold text-gray-100', dirty = false, dismissible = true,
  className = PANEL, zClassName = 'z-50', showClose = false, children,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Read during the first render: by the time effects run, an `autoFocus`
  // child has already taken focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) {
      (panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus();
    }
    return () => opener?.focus?.();
  }, [opener]);

  const requestClose = async () => {
    if (!dismissible) return;
    if (dirty && !(await confirmDiscard())) return;
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const [head, tail] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === head) {
      e.preventDefault();
      tail.focus();
    } else if (!e.shiftKey && document.activeElement === tail) {
      e.preventDefault();
      head.focus();
    }
  };

  return (
    <div
      className={`fixed inset-0 ${zClassName} flex items-center justify-center bg-black/70`}
      // Only a press that starts and ends on the backdrop closes: not a text
      // selection dragged out of the panel.
      onMouseDown={(e) => { if (e.target === e.currentTarget) e.currentTarget.dataset.down = '1'; }}
      onClick={(e) => {
        const started = e.currentTarget.dataset.down === '1';
        delete e.currentTarget.dataset.down;
        if (started && e.target === e.currentTarget) requestClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={`${className} focus:outline-none`}
      >
        {(title || showClose) && (
          <div className="flex items-center justify-between gap-4">
            {title && <h2 id={titleId} className={titleClassName}>{title}</h2>}
            {showClose && (
              <button
                onClick={requestClose}
                aria-label="Close"
                className="ml-auto text-gray-500 hover:text-gray-300 text-xl leading-none"
              >
                &times;
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
