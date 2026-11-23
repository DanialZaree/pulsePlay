import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Tauri runtime is not available in browser preview");
  }
  return invoke<T>(cmd, args);
}

export function getSafeWindow() {
  if (!isTauri()) return null;
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}
