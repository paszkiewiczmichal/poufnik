import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import { ENGINE_STATUS_EVENT, getEngineEndpoint, listenToEngineStatus } from "./engine";

describe("getEngineEndpoint", () => {
  it("invokes the get_engine_endpoint command", async () => {
    invoke.mockResolvedValue({ baseUrl: "http://127.0.0.1:8710" });

    await expect(getEngineEndpoint()).resolves.toEqual({ baseUrl: "http://127.0.0.1:8710" });
    expect(invoke).toHaveBeenCalledWith("get_engine_endpoint");
  });
});

describe("listenToEngineStatus", () => {
  it("subscribes to the engine status event and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listen.mockImplementation((event, callback) => {
      expect(event).toBe(ENGINE_STATUS_EVENT);
      callback({ payload: { status: "ready" } });
      return Promise.resolve(unlisten);
    });
    const handler = vi.fn();

    const result = await listenToEngineStatus(handler);

    expect(handler).toHaveBeenCalledWith({ status: "ready" });
    expect(result).toBe(unlisten);
  });
});
