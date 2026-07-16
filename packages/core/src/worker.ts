import { Job, Worker } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { Pool, type PoolConfig } from "pg";
import type { INodeExecutionRecord, IWorkflow, JsonValue, WorkflowId } from "@spiderz/shared";
import { WorkflowExecutor, type NodeExecutorResolver } from "./workflow-executor.js";

export const WORKFLOW_EXECUTION_QUEUE = "workflow-executions";

export interface WorkflowExecutionJob {
  readonly workflowId: WorkflowId;
  readonly executionId: string;
  readonly initialData: readonly JsonValue[];
  readonly requestedAt: string;
}

export interface WorkflowRepository { getById(id: WorkflowId): Promise<IWorkflow | undefined>; }

/** PostgreSQL adapter for a workflows(id uuid/text primary key, definition jsonb not null) table. */
export class PostgresWorkflowRepository implements WorkflowRepository {
  private readonly pool: Pool;
  public constructor(config: PoolConfig) { this.pool = new Pool(config); }
  public async getById(id: WorkflowId): Promise<IWorkflow | undefined> {
    const result = await this.pool.query<{ definition: IWorkflow | string }>("SELECT definition FROM workflows WHERE id = $1 LIMIT 1", [id]);
    const definition = result.rows[0]?.definition;
    if (definition === undefined) return undefined;
    return typeof definition === "string" ? JSON.parse(definition) as IWorkflow : definition;
  }
  public async close(): Promise<void> { await this.pool.end(); }
}

export interface WorkflowWorkerOptions {
  readonly redis: RedisOptions;
  readonly repository: WorkflowRepository;
  readonly resolveNodeExecutor: NodeExecutorResolver;
  readonly queueName?: string;
  readonly concurrency?: number;
  readonly beforeNodeExecute?: (node: import("@spiderz/shared").INode) => Promise<void> | void;
}

export interface WorkflowProgress {
  readonly executionId: string;
  readonly nodeId: string;
  readonly status: INodeExecutionRecord["status"];
  readonly completed: number;
  readonly total: number;
  readonly timestamp: string;
}

/** Starts a horizontally scalable BullMQ consumer. Each process owns its Redis connection. */
export function createWorkflowWorker(options: WorkflowWorkerOptions): Worker<WorkflowExecutionJob, { readonly executionId: string }> {
  const connection = new Redis({ ...options.redis, maxRetriesPerRequest: null });
  const worker = new Worker<WorkflowExecutionJob, { readonly executionId: string }>(
    options.queueName ?? WORKFLOW_EXECUTION_QUEUE,
    async (job: Job<WorkflowExecutionJob>, _token?: string, signal?: AbortSignal) => processJob(job, options, signal),
    { connection, concurrency: options.concurrency ?? 25 },
  );
  worker.on("error", (error: Error) => console.error("Workflow worker Redis error", error));
  return worker;
}

async function processJob(job: Job<WorkflowExecutionJob>, options: WorkflowWorkerOptions, signal?: AbortSignal): Promise<{ readonly executionId: string }> {
  const workflow = await options.repository.getById(job.data.workflowId);
  if (workflow === undefined) throw new Error(`Workflow '${job.data.workflowId}' was not found.`);
  const executor = new WorkflowExecutor(options.resolveNodeExecutor);
  await job.updateProgress({ executionId: job.data.executionId, completed: 0, total: workflow.nodes.length, timestamp: new Date().toISOString() } satisfies Partial<WorkflowProgress>);
  await executor.execute(workflow, {
    executionId: job.data.executionId,
    initialInput: job.data.initialData,
    ...(signal === undefined ? {} : { signal }),
    ...(options.beforeNodeExecute === undefined ? {} : { beforeNodeExecute: options.beforeNodeExecute }),
    onNodeComplete: async (record, completed, total) => {
      const progress: WorkflowProgress = { executionId: job.data.executionId, nodeId: record.nodeId, status: record.status, completed, total, timestamp: new Date().toISOString() };
      await job.updateProgress(progress);
    },
  });
  return { executionId: job.data.executionId };
}
