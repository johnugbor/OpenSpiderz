import type { JsonObject, JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** Emits a binary-storage reference without loading the file into worker memory. */
export class FileInputNodeExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const reference = context.node.parameters.binaryData;
    if (!isBinaryReference(reference)) throw new Error("File Input node requires an uploaded binary file.");
    return [{ binaryData: reference }];
  }
}

function isBinaryReference(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.dataId === "string" && typeof value.fileName === "string" && typeof value.mimeType === "string" && typeof value.fileSize === "number";
}
