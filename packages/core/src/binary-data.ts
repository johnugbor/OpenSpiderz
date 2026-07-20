import type { Readable } from "node:stream";
import type { IBinaryData } from "@spiderz/shared";

/** Storage is stream-first: workflow JSON contains only IBinaryData references. */
export interface BinaryStorageDriver { put(dataId: string, stream: Readable, metadata: Omit<IBinaryData, "dataId" | "fileSize">): Promise<IBinaryData>; get(dataId: string): Promise<Readable>; delete(dataId: string): Promise<void>; listOlderThan(cutoff: Date): AsyncIterable<string>; }
export class BinaryDataManager {
  public constructor(private readonly storage: BinaryStorageDriver) {}
  public async store(stream: Readable, metadata: Omit<IBinaryData, "dataId" | "fileSize">): Promise<IBinaryData> { return this.storage.put(crypto.randomUUID(), stream, metadata); }
  public open(reference: IBinaryData): Promise<Readable> { return this.storage.get(reference.dataId); }
  public delete(reference: IBinaryData): Promise<void> { return this.storage.delete(reference.dataId); }
}
