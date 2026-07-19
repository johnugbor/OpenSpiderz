import { describe, expect, it } from "vitest";
import type { IWorkflow } from "@spiderz/shared";
import { useWorkflowCanvasStore } from "./workflowCanvasStore.js";

function workflow(): IWorkflow {
  return {
    id: "workflow-1", name: "Test workflow", nodes: [
      { id: "webhook", name: "Webhook", type: "trigger", parameters: {}, position: { x: 0, y: 0 }, credentials: {} },
      { id: "code", name: "Code", type: "regular", parameters: { code: "return $input;" }, position: { x: 300, y: 0 }, credentials: {} },
    ], connections: [], settings: {}, variables: {},
  };
}

describe("workflowCanvasStore", () => {
  it("creates a graph edge and synchronizes it to the workflow", () => {
    const store = useWorkflowCanvasStore.getState();
    store.load(workflow());
    store.onConnect({ source: "webhook", target: "code", sourceHandle: "out-0", targetHandle: "in-0" });
    const state = useWorkflowCanvasStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.workflow?.connections).toEqual([{ sourceNodeId: "webhook", targetNodeId: "code", outputIndex: 0, inputIndex: 0 }]);
  });

  it("removes the workflow connection when its React Flow edge is removed", () => {
    const store = useWorkflowCanvasStore.getState();
    store.load(workflow());
    store.onConnect({ source: "webhook", target: "code", sourceHandle: "out-0", targetHandle: "in-0" });
    const edgeId = useWorkflowCanvasStore.getState().edges[0]?.id;
    expect(edgeId).toBeDefined();
    store.onEdgesChange([{ type: "remove", id: edgeId ?? "missing" }]);
    expect(useWorkflowCanvasStore.getState().workflow?.connections).toEqual([]);
  });

  it("removes related connections when a node is deleted", () => {
    const store = useWorkflowCanvasStore.getState();
    store.load(workflow());
    store.onConnect({ source: "webhook", target: "code", sourceHandle: "out-0", targetHandle: "in-0" });
    store.onNodesChange([{ type: "remove", id: "code" }]);
    const state = useWorkflowCanvasStore.getState();
    expect(state.workflow?.nodes.map((node) => node.id)).toEqual(["webhook"]);
    expect(state.workflow?.connections).toEqual([]);
    expect(state.edges).toEqual([]);
  });

  it("stores canvas lock state", () => {
    const store = useWorkflowCanvasStore.getState();
    store.setInteractive(false);
    expect(useWorkflowCanvasStore.getState().interactive).toBe(false);
    store.setInteractive(true);
    expect(useWorkflowCanvasStore.getState().interactive).toBe(true);
  });
});
