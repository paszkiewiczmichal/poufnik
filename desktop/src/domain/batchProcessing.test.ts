import { describe, expect, it } from "vitest";

import {
  BATCH_CONCURRENCY_LIMIT,
  batchProgress,
  createBatchQueueItems,
  processBatchQueue,
} from "./batchProcessing";
import type { BatchProcessSuccess, BatchQueueItem } from "../types";

describe("batch processing", () => {
  it("creates queued items and reports progress", () => {
    const items = createBatchQueueItems([
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]);
    items[0] = { ...items[0], status: "done" };
    items[1] = { ...items[1], status: "error" };

    expect(items.map((item) => item.status)).toEqual(["done", "error"]);
    expect(batchProgress(items)).toEqual({ complete: 1, failed: 1, total: 2 });
  });

  it("processes within the configured concurrency limit and stores per-file results", async () => {
    const items = createBatchQueueItems(
      Array.from({ length: 5 }, (_, index) => new File([String(index)], `plik-${index}.txt`)),
    );
    const updates = new Map<string, BatchQueueItem>(items.map((item) => [item.id, item]));
    let active = 0;
    let maxActive = 0;

    await processBatchQueue(
      items,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return successFor(item);
      },
      (itemId, patch) => {
        updates.set(itemId, { ...updates.get(itemId)!, ...patch });
      },
      BATCH_CONCURRENCY_LIMIT,
    );

    expect(BATCH_CONCURRENCY_LIMIT).toBeLessThanOrEqual(2);
    expect(maxActive).toBeLessThanOrEqual(BATCH_CONCURRENCY_LIMIT);
    expect([...updates.values()].map((item) => item.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect([...updates.values()].map((item) => item.entityCount)).toEqual([1, 1, 1, 1, 1]);
  });

  it("marks failed files without stopping the queue", async () => {
    const items = createBatchQueueItems([
      new File(["ok"], "ok.txt"),
      new File(["bad"], "bad.txt"),
      new File(["again"], "again.txt"),
    ]);
    const updates = new Map<string, BatchQueueItem>(items.map((item) => [item.id, item]));

    await processBatchQueue(
      items,
      async (item) => {
        if (item.filename === "bad.txt") {
          throw new Error("parse failed");
        }
        return successFor(item);
      },
      (itemId, patch) => {
        updates.set(itemId, { ...updates.get(itemId)!, ...patch });
      },
    );

    expect([...updates.values()].map((item) => item.status)).toEqual([
      "done",
      "error",
      "done",
    ]);
    expect(updates.get(items[1].id)?.error).toBe("parse failed");
  });
});

function successFor(item: BatchQueueItem): BatchProcessSuccess {
  return {
    document: {
      filename: item.filename,
      format: "txt",
      source: "parsed",
      page_count: 1,
      text: "Jan Kowalski",
    },
    anonymizedText: "[OSOBA_1]",
    replacementMap: {
      entries: [
        {
          token: "[OSOBA_1]",
          category: "PERSON",
          canonical_text: "Jan Kowalski",
          variants: ["Jan Kowalski"],
        },
      ],
      document_fingerprint: "abc",
    },
    entityCount: 1,
  };
}
