import { Queue, type JobsOptions } from "bullmq";
import { createHash } from "node:crypto";
import { Redis, type RedisOptions } from "ioredis";
import type { JsonValue, WorkflowId } from "@spiderz/shared";

export const WORKFLOW_EXECUTION_QUEUE = "workflow-executions";

export interface WorkflowExecutionJob {
  readonly workflowId: WorkflowId;
  readonly executionId: string;
  readonly initialData: readonly JsonValue[];
  readonly requestedAt: string;
}

export interface QueueManagerOptions {
  readonly redis: RedisOptions;
  readonly queueName?: string;
}

/** Producer used by webhook and schedule handlers; it never executes a workflow in the API process. */
export class QueueManager {
  private readonly connection: Redis;
  private readonly queue: Queue<WorkflowExecutionJob>;

  public constructor(options: QueueManagerOptions) {
    this.connection = new Redis({ ...options.redis, maxRetriesPerRequest: null });
    this.queue = new Queue(options.queueName ?? WORKFLOW_EXECUTION_QUEUE, { connection: this.connection });
  }

  public async enqueueExecution(workflowId: WorkflowId, initialData: readonly JsonValue[], options: JobsOptions = {}): Promise<WorkflowExecutionJob> {
    const payload: WorkflowExecutionJob = { workflowId, initialData: [...initialData], executionId: crypto.randomUUID(), requestedAt: new Date().toISOString() };
    await this.queue.add("execute-workflow", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 50_000 },
      ...options,
    });
    return payload;
  }

  /** Deterministic BullMQ job IDs make Redis lease retries idempotent. */
  public async enqueueTriggeredExecution(workflowId: WorkflowId, initialData: readonly JsonValue[], idempotencyKey: string): Promise<void> {
    await this.enqueueExecution(workflowId, initialData, { jobId: createHash("sha256").update(idempotencyKey).digest("hex") });
  }

  public async close(): Promise<void> { await this.queue.close(); await this.connection.quit(); }
}
