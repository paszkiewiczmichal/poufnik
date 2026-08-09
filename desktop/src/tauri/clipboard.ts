import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
    return;
  } catch {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error("Clipboard is unavailable.");
  }
}

export async function readClipboardText(): Promise<string> {
  return readText();
}
