// PROTOTYPE - NOT FOR PRODUCTION
/** Keep keyboard focus and battle shortcuts inside an open dialog; return a teardown callback. */
export function containDialogFocus(
  dialog: HTMLElement,
  onDismiss?: () => void,
  allowedShortcutCodes: readonly string[] = [],
): () => void {
  const owner = dialog.ownerDocument;
  const opener = owner.activeElement as HTMLElement | null;
  const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
  ));
  const keydown = (event: KeyboardEvent) => {
    const editable = (event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
    // Only an explicit opt-in may reach global shortcuts; typing and native controls stay local.
    if (!editable && allowedShortcutCodes.includes(event.code)) return;
    event.stopPropagation();
    if (onDismiss && (event.key === 'Escape' || (event.code === 'KeyP' && !editable))) {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusables();
    const first = controls[0], last = controls[controls.length - 1];
    if (!first || !last) {
      event.preventDefault(); dialog.focus();
    } else if (event.shiftKey && (owner.activeElement === first || owner.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (owner.activeElement === last || owner.activeElement === dialog)) {
      event.preventDefault(); first.focus();
    }
  };
  const focusin = () => {
    if (!dialog.contains(owner.activeElement)) dialog.focus();
  };
  dialog.addEventListener('keydown', keydown);
  owner.addEventListener('focusin', focusin);
  dialog.focus();
  return () => {
    dialog.removeEventListener('keydown', keydown);
    owner.removeEventListener('focusin', focusin);
    if (dialog.contains(owner.activeElement) && opener?.isConnected) opener.focus();
  };
}
