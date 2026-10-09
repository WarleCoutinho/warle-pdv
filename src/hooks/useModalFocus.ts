import { useEffect, useRef, type RefObject } from 'react';

type ModalFocusOptions = { closeOnEscape?: boolean; active?: boolean };
const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focus management local ao diálogo: foco inicial, trap de Tab, Esc opcional e retorno ao fechar. */
export function useModalFocus<T extends HTMLElement>(onClose?: () => void, options: ModalFocusOptions = {}): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const escapeRef = useRef(options.closeOnEscape !== false);
  const active = options.active !== false;
  closeRef.current = onClose;
  escapeRef.current = options.closeOnEscape !== false;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const autofocus = dialog.querySelector<HTMLElement>('[autofocus], [data-initial-focus=true]');
    const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (autofocus ?? firstFocusable ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && escapeRef.current && closeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active]);

  return dialogRef;
}
