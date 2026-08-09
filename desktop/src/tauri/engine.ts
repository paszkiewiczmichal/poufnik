import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { EngineEndpoint, EngineStatusEvent } from "../types";

export const ENGINE_STATUS_EVENT = "engine://status";

export async function getEngineEndpoint(): Promise<EngineEndpoint> {
  return invoke<EngineEndpoint>("get_engine_endpoint");
}

export async function listenToEngineStatus(
  handler: (event: EngineStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<EngineStatusEvent>(ENGINE_STATUS_EVENT, (event) => handler(event.payload));
}
