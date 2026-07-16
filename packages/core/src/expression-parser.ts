import ivm from "isolated-vm";
import type { IExecutionState, IWorkflow, JsonObject, JsonValue } from "@spiderz/shared";

const EXPRESSION_PATTERN = /\{\{([\s\S]*?)\}\}/g;
const WHOLE_EXPRESSION_PATTERN = /^\s*\{\{([\s\S]*?)\}\}\s*$/;
const EXPRESSION_TIMEOUT_MS = 50;
const EXPRESSION_MEMORY_LIMIT_MB = 8;

export interface ExpressionContext {
  readonly workflow: IWorkflow;
  readonly execution: IExecutionState;
  readonly input: readonly JsonValue[];
}

/** Evaluates n8n-style parameter templates in a short-lived, memory-limited V8 isolate. */
export class ExpressionParser {
  public async resolveParameters(parameters: Readonly<Record<string, JsonValue>>, context: ExpressionContext): Promise<Readonly<Record<string, JsonValue>>> {
    return this.resolveValue(parameters, context) as Promise<Readonly<Record<string, JsonValue>>>;
  }

  private async resolveValue(value: JsonValue, context: ExpressionContext): Promise<JsonValue> {
    if (typeof value === "string") return this.resolveTemplate(value, context);
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.resolveValue(item, context)));
    if (value === null || typeof value !== "object") return value;
    const resolved: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) resolved[key] = await this.resolveValue(item, context);
    return resolved;
  }

  private async resolveTemplate(template: string, context: ExpressionContext): Promise<JsonValue> {
    const whole = WHOLE_EXPRESSION_PATTERN.exec(template);
    if (whole?.[1] !== undefined) return this.evaluate(whole[1], context);
    const matches = [...template.matchAll(EXPRESSION_PATTERN)];
    if (matches.length === 0) return template;
    let cursor = 0;
    let output = "";
    for (const match of matches) {
      output += template.slice(cursor, match.index);
      const evaluated = await this.evaluate(match[1] ?? "", context);
      output += evaluated === null ? "" : typeof evaluated === "object" ? JSON.stringify(evaluated) : String(evaluated);
      cursor = (match.index ?? 0) + match[0].length;
    }
    return output + template.slice(cursor);
  }

  private async evaluate(source: string, context: ExpressionContext): Promise<JsonValue> {
    const isolate = new ivm.Isolate({ memoryLimit: EXPRESSION_MEMORY_LIMIT_MB });
    try {
      const sandbox = await isolate.createContext();
      const jail = sandbox.global;
      await jail.set("globalThis", jail.derefInto());
      await jail.set("__expressionContext", new ivm.ExternalCopy(this.createSandboxContext(context)).copyInto());
      const script = await isolate.compileScript(`${SAFE_ACCESS_RUNTIME}\n__evaluateExpression(${JSON.stringify(source)})`);
      const result = await script.run(sandbox, { timeout: EXPRESSION_TIMEOUT_MS, copy: true });
      return toJsonValue(result);
    } catch {
      // Expressions must never make an execution fail. Syntax, timeout, and runtime errors resolve as null.
      return null;
    } finally {
      isolate.dispose();
    }
  }

  private createSandboxContext(context: ExpressionContext): JsonObject {
    const latestByNodeId = new Map<string, JsonValue>();
    for (const record of context.execution.history) latestByNodeId.set(record.nodeId, record.output?.[0] ?? null);
    const nodes: Record<string, JsonValue> = {};
    for (const node of context.workflow.nodes) nodes[node.name] = { json: latestByNodeId.get(node.id) ?? null };
    return {
      json: context.input[0] ?? null,
      node: nodes,
      vars: { ...context.workflow.variables },
      executionId: context.execution.id,
    };
  }
}

/* This runtime never exposes host references. Proxy sentinels turn missing property chains into null. */
const SAFE_ACCESS_RUNTIME = `
const __nilTarget = function () {};
const __nil = new Proxy(__nilTarget, {
  get: (_target, property) => property === Symbol.toPrimitive ? (() => null) : __nil,
  apply: () => __nil,
  construct: () => __nil,
});
const __proxies = new WeakMap();
function __safe(value) {
  if (value === null || value === undefined) return __nil;
  if (typeof value !== 'object' && typeof value !== 'function') return value;
  if (__proxies.has(value)) return __proxies.get(value);
  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      try {
        const member = Reflect.get(target, property, receiver);
        if (typeof member === 'function') return (...args) => __safe(member.apply(target, args));
        return __safe(member);
      } catch { return __nil; }
    },
  });
  __proxies.set(value, proxy);
  return proxy;
}
function __unwrap(value) { return value === __nil || typeof value === 'undefined' ? null : value; }
function __evaluateExpression(source) {
  try {
    const $json = __safe(__expressionContext.json);
    const $node = __safe(__expressionContext.node);
    const $vars = __safe(__expressionContext.vars);
    const $executionId = __expressionContext.executionId;
    const expression = new Function('$json', '$node', '$vars', '$executionId', '"use strict"; return (' + source + ');');
    return __unwrap(expression($json, $node, $vars, $executionId));
  } catch { return null; }
}
`;

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, seen));
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) output[key] = toJsonValue(item, seen);
  return output;
}
