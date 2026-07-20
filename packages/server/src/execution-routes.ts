import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import type { JsonValue } from "@spiderz/shared";
import { QueueManager } from "./queue-manager.js";
import { requireWorkspaceRole } from "./rbac.js";
import { Redis } from "ioredis";

export function registerExecutionRoutes(app: FastifyInstance, config: PoolConfig, queue: QueueManager): void {
  const pool = new Pool(config);
  const viewRoles = requireWorkspaceRole(config, "owner", "admin", "member", "read_only");
  app.get<{ Params: { workspaceId: string; workflowId: string } }>("/api/workspaces/:workspaceId/workflows/:workflowId/executions", { preHandler: viewRoles }, async (request) => (await pool.query("SELECT id,status,started_at,finished_at,created_at FROM execution_logs WHERE workflow_id=$1 ORDER BY created_at DESC LIMIT 100", [request.params.workflowId])).rows);
  app.get<{ Params: { workspaceId: string; executionId: string } }>("/api/workspaces/:workspaceId/executions/:executionId", { preHandler: viewRoles }, async (request, reply) => { const result = await pool.query("SELECT e.* FROM execution_logs e JOIN workflows w ON w.id=e.workflow_id WHERE e.id=$1 AND w.workspace_id=$2", [request.params.executionId, request.params.workspaceId]); return result.rows[0] === undefined ? reply.code(404).send({ error: "Execution not found." }) : result.rows[0]; });
  app.get<{ Params: { workspaceId: string; workflowId: string; executionId: string } }>("/api/workspaces/:workspaceId/workflows/:workflowId/executions/:executionId/events", { preHandler: viewRoles }, async (request, reply) => { const workflow = await pool.query("SELECT 1 FROM workflows WHERE id=$1 AND workspace_id=$2", [request.params.workflowId, request.params.workspaceId]); if (workflow.rows[0] === undefined) return reply.code(404).send({ error: "Workflow not found." }); const subscriber = new Redis({ ...queue.redisOptions, maxRetriesPerRequest: null }); const close = (): void => { void subscriber.quit(); }; reply.hijack(); reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" }); reply.raw.write("event: connected\ndata: {}\n\n"); subscriber.on("message", (_channel, message) => { reply.raw.write(`event: progress\ndata: ${message}\n\n`); }); reply.raw.on("close", close); await subscriber.subscribe(`workflow-progress:${request.params.executionId}`); });
  app.post<{ Params: { workspaceId: string; workflowId: string }; Body: { input?: JsonValue[] } }>("/api/workspaces/:workspaceId/workflows/:workflowId/execute", { preHandler: requireWorkspaceRole(config, "owner", "admin", "member") }, async (request, reply) => {
    const input = request.body?.input ?? [];
    if (!Array.isArray(input)) return reply.code(400).send({ error: "input must be a JSON array." });
    const workflow = await pool.query("SELECT id FROM workflows WHERE id=$1 AND workspace_id=$2", [request.params.workflowId, request.params.workspaceId]);
    if (workflow.rows[0] === undefined) return reply.code(404).send({ error: "Workflow not found." });
    const job = await queue.enqueueExecution(request.params.workflowId, input);
    return reply.code(202).send({ executionId: job.executionId, status: "queued" });
  });
}
