import { describe, expect, it } from "vitest";
import type { IWorkflow, JsonValue } from "@spiderz/shared";
import { WorkflowExecutor, WorkflowNodeExecutor, type INodeExecutionContext } from "./workflow-executor.js";

class WebhookExecutor extends WorkflowNodeExecutor { public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> { return context.input; } }
class CaptureExecutor extends WorkflowNodeExecutor { public received: readonly JsonValue[] = []; public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> { this.received = context.input; return context.input; } }

describe("workflow execution", () => {
  it("passes a webhook payload into its downstream node", async () => {
    const capture = new CaptureExecutor();
    const workflow: IWorkflow = { id: "workflow", name: "Webhook path", settings: {}, variables: {}, nodes: [{ id: "webhook", name: "Webhook", type: "trigger", parameters: { triggerKind: "webhook" }, position: { x: 0, y: 0 }, credentials: {} }, { id: "next", name: "Next", type: "regular", parameters: {}, position: { x: 200, y: 0 }, credentials: {} }], connections: [{ sourceNodeId: "webhook", targetNodeId: "next", outputIndex: 0, inputIndex: 0 }] };
    const executor = new WorkflowExecutor((node) => node.id === "webhook" ? new WebhookExecutor() : node.id === "next" ? capture : undefined);
    const state = await executor.execute(workflow, { executionId: "execution", initialInput: [{ event: "received" }] });
    expect(state.status).toBe("succeeded");
    expect(capture.received).toEqual([{ event: "received" }]);
  });
});
