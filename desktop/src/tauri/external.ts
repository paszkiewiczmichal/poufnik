import { open } from "@tauri-apps/plugin-shell";

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

