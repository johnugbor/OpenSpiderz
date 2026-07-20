import { Readable } from "node:stream";
import type { JsonValue } from "@spiderz/shared";
import { BinaryDataManager, WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** HTTP node supports JSON responses and streaming file responses without buffering. */
export class HttpRequestNodeExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly binary: BinaryDataManager) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const url = context.node.parameters.url;
    if (typeof url !== "string") throw new Error("HTTP Request node requires a URL.");
    const method = typeof context.node.parameters.method === "string" ? context.node.parameters.method : "GET";
    const response = await fetch(url, { method, signal: context.signal });
    if (!response.ok) throw new Error(`HTTP request failed (${response.status}).`);
    if (context.node.parameters.responseFormat !== "file") return [await response.json() as JsonValue];
    if (response.body === null) throw new Error("HTTP response did not contain a body.");
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "download";
    return [await this.binary.store(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream), { mimeType, fileName }) as unknown as JsonValue];
  }
}
