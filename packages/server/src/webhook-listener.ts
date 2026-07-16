import type { FastifyInstance, FastifyRequest } from "fastify";
import type { JsonObject, JsonValue, NodeId, WorkflowId } from "@spiderz/shared";
import { QueueManager } from "./queue-manager.js";
import { WorkflowRepository } from "./workflow-repository.js";

interface WebhookParams { readonly workflowId: WorkflowId; readonly nodeId: NodeId; }
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

export function registerWebhookListener(app: FastifyInstance, repository: WorkflowRepository, queue: QueueManager): void {
  app.route<{ Params: WebhookParams }>({
    method: ["GET", "POST"],
    url: "/webhook/:workflowId/:nodeId",
    handler: async (request, reply) => handleWebhook(request, reply, repository, queue),
  });
}

async function handleWebhook(request: FastifyRequest<{ Params: WebhookParams }>, reply: { code(statusCode: number): { send(payload: JsonValue): unknown } }, repository: WorkflowRepository, queue: QueueManager): Promise<unknown> {
  const { workflowId, nodeId } = request.params;
  if (!isIdentifier(workflowId) || !isIdentifier(nodeId)) return reply.code(400).send({ error: "Invalid workflow or node identifier." });
  const workflow = await repository.getEnabledById(workflowId);
  if (workflow === undefined) return reply.code(404).send({ error: "Workflow not found or disabled." });
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined || node.type !== "trigger") return reply.code(404).send({ error: "Webhook trigger not found." });
  const payload: JsonObject = {
    method: request.method,
    headers: requestHeaders(request),
    query: toJson(request.query ?? {}),
    body: toJson(request.body ?? null),
    receivedAt: new Date().toISOString(),
    sourceIp: request.ip,
  };
  const job = await queue.enqueueExecution(workflow.id, [payload]);
  return reply.code(202).send({ executionId: job.executionId, status: "queued" });
}

function requestHeaders(request: FastifyRequest): JsonObject {
  const headers: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || SENSITIVE_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = toJson(value);
  }
  return headers;
}

function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = toJson(entry);
    return output;
  }
  return null;
}

function isIdentifier(value: string): boolean { return /^[a-zA-Z0-9_-]{1,128}$/.test(value); }
