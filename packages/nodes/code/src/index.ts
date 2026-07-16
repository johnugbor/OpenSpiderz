import ivm from "isolated-vm";
import ts from "typescript";
import type { INode, JsonObject, JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

const EXECUTION_TIMEOUT_MS = 2_000;
const MEMORY_LIMIT_MB = 32;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const DISALLOWED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class CodeNodeConfigurationError extends Error {
  public constructor(message: string) { super(message); this.name = "CodeNodeConfigurationError"; }
}

export class CodeNodeExecutionError extends Error {
  public constructor(message: string, public override readonly cause: unknown) { super(message); this.name = "CodeNodeExecutionError"; }
}

export interface CodeNodeParameters {
  readonly code: string;
  readonly language?: "javascript" | "typescript";
}

/** Native-isolate Code node. No host functions, Node globals, modules, or credentials enter the isolate. */
export class CodeNodeExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const parameters = readParameters(context.node);
    const source = compileUserSource(parameters);
    const input = normalizePayload(context.input);
    const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    let isolateDisposed = false;
    try {
      const sandbox = await isolate.createContext();
      const jail = sandbox.global;
      await jail.set("globalThis", jail.derefInto());
      await jail.set("$input", new ivm.ExternalCopy(input).copyInto());
      const script = await isolate.compileScript(`
        (async () => {
          "use strict";
          const __result = await (async () => {
            ${source}
          })();
          return __result;
        })()
      `);
      const result = await deadline(
        script.run(sandbox, { timeout: EXECUTION_TIMEOUT_MS, promise: true, copy: true }),
        EXECUTION_TIMEOUT_MS,
      );
      return normalizeResult(result);
    } catch (error: unknown) {
      throw new CodeNodeExecutionError("Code node execution failed.", error);
    } finally {
      if (!isolateDisposed) {
        isolate.dispose();
        isolateDisposed = true;
      }
    }
  }
}

function readParameters(node: INode): CodeNodeParameters {
  const code = node.parameters.code;
  const language = node.parameters.language;
  if (typeof code !== "string" || code.trim().length === 0) throw new CodeNodeConfigurationError("Code node parameter 'code' must be a non-empty string.");
  if (language !== undefined && language !== "javascript" && language !== "typescript") throw new CodeNodeConfigurationError("Code node parameter 'language' must be 'javascript' or 'typescript'.");
  if (new TextEncoder().encode(code).byteLength > MAX_SOURCE_BYTES) throw new CodeNodeConfigurationError("Code exceeds the 256 KiB source limit.");
  return { code, ...(language === undefined ? {} : { language }) };
}

function compileUserSource(parameters: CodeNodeParameters): string {
  if (parameters.language !== "typescript") return parameters.code;
  const transpiled = ts.transpileModule(parameters.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true },
    reportDiagnostics: true,
  });
  const diagnostic = transpiled.diagnostics?.find((item) => item.category === ts.DiagnosticCategory.Error);
  if (diagnostic !== undefined) throw new CodeNodeConfigurationError(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  return transpiled.outputText;
}

function deadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Execution exceeded ${timeoutMs}ms.`)), timeoutMs);
    void task.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

function normalizeResult(value: unknown): readonly JsonValue[] {
  if (value === undefined) throw new CodeNodeExecutionError("Code must return a JSON object or array.", value);
  const json = normalizeJson(value, new WeakSet<object>());
  const output = Array.isArray(json) ? json : [json];
  return normalizePayload(output);
}

function normalizePayload(payload: readonly JsonValue[]): readonly JsonValue[] {
  const normalized = payload.map((value) => normalizeJson(value, new WeakSet<object>()));
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_PAYLOAD_BYTES) throw new CodeNodeExecutionError("Payload exceeds the 4 MiB transfer limit.", undefined);
  return normalized;
}

function normalizeJson(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CodeNodeExecutionError("Only finite numbers are valid JSON values.", value);
    return value;
  }
  if (typeof value !== "object") throw new CodeNodeExecutionError("Code returned a non-JSON value.", value);
  if (seen.has(value)) throw new CodeNodeExecutionError("Code returned a circular value.", value);
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry, seen));
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    if (DISALLOWED_KEYS.has(key)) throw new CodeNodeExecutionError(`Returned object contains prohibited key '${key}'.`, value);
    output[key] = normalizeJson(entry, seen);
  }
  return output;
}
