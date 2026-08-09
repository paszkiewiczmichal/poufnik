import type { BatchProcessSuccess, BatchQueueItem } from "../types";

export const BATCH_CONCURRENCY_LIMIT = 1;

let nextBatchId = 1;

export type BatchItemPatch = Partial<
  Pick<
    BatchQueueItem,
    "status" | "entityCount" | "error" | "document" | "anonymizedText" | "replacementMap"
  >
>;

export function createBatchQueueItems(files: File[]): BatchQueueItem[] {
  return files.map((file) => ({
    id: `batch-${nextBatchId++}`,
    file,
    filename: file.name,
    size: file.size,
    status: "queued",
    entityCount: null,
    error: null,
    document: null,
    anonymizedText: null,
    replacementMap: null,
  }));
}

export function batchProgress(items: BatchQueueItem[]): {
  complete: number;
  failed: number;
  total: number;
} {
  return {
    complete: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "error").length,
    total: items.length,
  };
}

export async function processBatchQueue(
  items: BatchQueueItem[],
  processItem: (item: BatchQueueItem) => Promise<BatchProcessSuccess>,
  onItemChange: (itemId: string, patch: BatchItemPatch) => void,
  concurrency = BATCH_CONCURRENCY_LIMIT,
): Promise<void> {
  const pending = items.filter((item) => item.status === "queued" || item.status === "error");
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      onItemChange(item.id, { status: "processing", error: null });
      try {
        const result = await processItem(item);
        onItemChange(item.id, {
          status: "done",
          entityCount: result.entityCount,
          error: null,
          document: result.document,
          anonymizedText: result.anonymizedText,
          replacementMap: result.replacementMap,
        });
      } catch (error) {
        onItemChange(item.id, {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), pending.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
