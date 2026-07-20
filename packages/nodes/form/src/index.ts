import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** A hosted Form Trigger forwards public form submissions into the workflow. */
export class FormTriggerNodeExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> { return context.input; }
}
