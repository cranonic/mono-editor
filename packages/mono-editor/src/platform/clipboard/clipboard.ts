/**
 * Unified clipboard helper for Mono Editor.
 * Supports:
 * 1. Capacitor native Clipboard plugin (Android / iOS WebView builds)
 * 2. Async Clipboard API (`navigator.clipboard`)
 * 3. Legacy `document.execCommand('copy' | 'paste')` fallback (preserves focus)
 * 4. In-memory clipboard mirror so copy/cut -> paste always works even inside
 *    restricted iframes or mobile WebViews where OS `clipboard-read` is blocked.
 */

let lastCopiedText = '';
let lastWriteReachedNative = false;

interface CapacitorClipboardPlugin {
  write?: (options: { string: string }) => Promise<void>;
  read?: () => Promise<{ value?: string; type?: string }>;
}

function getCapacitorClipboard(): CapacitorClipboardPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Clipboard?: CapacitorClipboardPlugin } } }).Capacitor;
  return cap?.Plugins?.Clipboard ?? null;
}

export function setLastCopiedText(text: string): void {
  if (text) lastCopiedText = text;
}

export function getLastCopiedText(): string {
  return lastCopiedText;
}

function execCommandCopyFallback(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const prevActive = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  Object.assign(ta.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  });
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    ta.remove();
    if (prevActive && typeof prevActive.focus === 'function') {
      try {
        prevActive.focus({ preventScroll: true });
      } catch {
        prevActive.focus();
      }
    }
  }
  return ok;
}

function execCommandPasteFallback(): string {
  if (typeof document === 'undefined' || !document.body) return '';
  const prevActive = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  Object.assign(ta.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  });
  document.body.appendChild(ta);
  let pasted = '';
  try {
    ta.focus({ preventScroll: true });
    const ok = document.execCommand('paste');
    if (ok && ta.value) pasted = ta.value;
  } catch {
    pasted = '';
  } finally {
    ta.remove();
    if (prevActive && typeof prevActive.focus === 'function') {
      try {
        prevActive.focus({ preventScroll: true });
      } catch {
        prevActive.focus();
      }
    }
  }
  return pasted;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  lastCopiedText = text;
  lastWriteReachedNative = false;

  const capClip = getCapacitorClipboard();
  if (capClip?.write) {
    try {
      await capClip.write({ string: text });
      lastWriteReachedNative = true;
      return true;
    } catch {
      // Fall through to web clipboard APIs
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      lastWriteReachedNative = true;
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  const copied = execCommandCopyFallback(text);
  if (copied) lastWriteReachedNative = true;
  return copied;
}

export async function readClipboardText(): Promise<string> {
  const capClip = getCapacitorClipboard();
  if (capClip?.read) {
    try {
      const res = await capClip.read();
      if (typeof res?.value === 'string' && res.value.length > 0) {
        lastCopiedText = res.value;
        return res.value;
      }
    } catch {
      // Fall through to web clipboard APIs
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        lastCopiedText = text;
        return text;
      }
      // If native read returned empty and our last copy failed to reach native clipboard,
      // prefer the in-memory mirror rather than losing copied text.
      if (!lastWriteReachedNative && lastCopiedText) {
        return lastCopiedText;
      }
    } catch {
      // Blocked by permissions policy / iframe / mobile WebView — fall through
    }
  }

  const execText = execCommandPasteFallback();
  if (execText) {
    lastCopiedText = execText;
    return execText;
  }

  return lastCopiedText;
}
