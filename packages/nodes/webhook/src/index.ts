import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** Webhook triggers forward their received request payload into the DAG. */
export class WebhookNodeExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> { return context.input; }
}
