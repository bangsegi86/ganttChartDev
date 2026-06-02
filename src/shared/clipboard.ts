import { isElectron, bridge } from './bridge';

/**
 * Cross-context clipboard access.
 *
 * In packaged Electron the renderer is served from `file://`, which is NOT a
 * secure context, so `navigator.clipboard` is `undefined` and any call throws
 * (silently breaking copy/paste). We therefore prefer Electron's native
 * clipboard module via the preload bridge, and only fall back to
 * `navigator.clipboard` when running in a plain browser (dev/secure context).
 */
export async function readClipboardText(): Promise<string> {
  if (isElectron()) {
    try {
      return bridge().clipboard.readText();
    } catch {
      return '';
    }
  }
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    /* permission denied / not focused */
  }
  return '';
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isElectron()) {
    try {
      bridge().clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    /* ignore */
  }
}
