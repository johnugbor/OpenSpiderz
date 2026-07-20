import type { BinaryStorageDriver } from "@spiderz/core";
/** Run on a schedule after execution-log retention expires. */
export async function cleanupOrphanedBinaryData(storage: BinaryStorageDriver, retentionDays: number): Promise<number> { const cutoff=new Date(Date.now()-retentionDays*86_400_000); let count=0; for await(const dataId of storage.listOlderThan(cutoff)){await storage.delete(dataId);count++;} return count; }
