import { describe, expect, it } from "vitest";
import type { IWorkflow } from "@spiderz/shared";
import { validateWorkflow } from "./WorkflowCanvas.js";

const base = (): IWorkflow => ({ id: "workflow", name: "Test", settings: {}, variables: {}, nodes: [{ id: "trigger", name: "Webhook", type: "trigger", parameters: {}, position: { x: 0, y: 0 }, credentials: {} }], connections: [] });

describe("validateWorkflow", () => {
  it("rejects cyclic graphs", () => { const workflow = base(); const nodes = [...workflow.nodes, { id: "http", name: "HTTP Request", type: "regular" as const, parameters: { url: "https://example.com" }, position: { x: 1, y: 1 }, credentials: {} }]; expect(validateWorkflow({ ...workflow, nodes, connections: [{ sourceNodeId: "trigger", targetNodeId: "http", outputIndex: 0, inputIndex: 0 }, { sourceNodeId: "http", targetNodeId: "trigger", outputIndex: 0, inputIndex: 0 }] }).errors).toContain("This workflow contains a cycle."); });
  it("requires an HTTP URL", () => { const workflow = base(); const nodes = [...workflow.nodes, { id: "http", name: "HTTP Request", type: "regular" as const, parameters: {}, position: { x: 1, y: 1 }, credentials: {} }]; expect(validateWorkflow({ ...workflow, nodes, connections: [{ sourceNodeId: "trigger", targetNodeId: "http", outputIndex: 0, inputIndex: 0 }] }).errors).toContain("HTTP Request nodes require a URL."); });
  it("requires Code and Postgres settings", () => { const workflow = base(); const nodes = [...workflow.nodes, { id: "code", name: "Code", type: "regular" as const, parameters: {}, position: { x: 1, y: 1 }, credentials: {} }, { id: "database", name: "Postgres", type: "regular" as const, parameters: {}, position: { x: 2, y: 2 }, credentials: {} }]; const errors = validateWorkflow({ ...workflow, nodes, connections: [{ sourceNodeId: "trigger", targetNodeId: "code", outputIndex: 0, inputIndex: 0 }, { sourceNodeId: "code", targetNodeId: "database", outputIndex: 0, inputIndex: 0 }] }).errors; expect(errors).toContain("Code nodes require code."); expect(errors).toContain("Postgres nodes require a query."); });
});
