import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { IConnection, INode, IWorkflow } from "@spiderz/shared";
import { saveWorkflow } from "../api/workflows.js";

interface WorkflowNodeData extends Record<string, unknown> { readonly workflowNode: INode; }
interface WorkflowEdgeData extends Record<string, unknown> { readonly connection: IConnection; }
type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;
type WorkflowFlowEdge = Edge<WorkflowEdgeData>;

export interface WorkflowCanvasProps { readonly initialWorkflow: IWorkflow; }

function connectionId(connection: IConnection): string {
  return `${connection.sourceNodeId}:${connection.outputIndex}->${connection.targetNodeId}:${connection.inputIndex}`;
}

function WorkflowNode({ data }: NodeProps<WorkflowFlowNode>): ReactElement {
  const node = data.workflowNode;
  return <div className="workflow-node">
    {node.type !== "trigger" && <Handle type="target" position={Position.Left} id="in-0" />}
    <strong>{node.name}</strong><small>{node.type}</small>
    <Handle type="source" position={Position.Right} id="out-0" />
  </div>;
}

function toFlowNodes(nodes: readonly INode[]): WorkflowFlowNode[] {
  return nodes.map((node) => ({ id: node.id, type: "workflow", position: node.position, data: { workflowNode: node } }));
}
function toFlowEdges(connections: readonly IConnection[]): WorkflowFlowEdge[] {
  return connections.map((connection) => ({ id: connectionId(connection), source: connection.sourceNodeId, target: connection.targetNodeId, sourceHandle: `out-${connection.outputIndex}`, targetHandle: `in-${connection.inputIndex}`, data: { connection } }));
}
function indexFromHandle(handle: string | null, prefix: "in" | "out"): number {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(handle ?? "");
  if (match?.[1] === undefined) return 0;
  return Number(match[1]);
}

export function WorkflowCanvas({ initialWorkflow }: WorkflowCanvasProps): ReactElement {
  const [workflow, setWorkflow] = useState<IWorkflow>(initialWorkflow);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialWorkflow.name);
  useEffect(() => { setWorkflow(initialWorkflow); setTitleDraft(initialWorkflow.name); }, [initialWorkflow]);
  const nodes = useMemo(() => toFlowNodes(workflow.nodes), [workflow.nodes]);
  const edges = useMemo(() => toFlowEdges(workflow.connections), [workflow.connections]);

  const onNodesChange: OnNodesChange<WorkflowFlowNode> = useCallback((changes) => {
    setWorkflow((current) => {
      const nextNodes = applyNodeChanges(changes, toFlowNodes(current.nodes));
      const remainingIds = new Set(nextNodes.map((node) => node.id));
      return { ...current, nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })), connections: current.connections.filter((edge) => remainingIds.has(edge.sourceNodeId) && remainingIds.has(edge.targetNodeId)) };
    });
  }, []);

  const onEdgesChange: OnEdgesChange<WorkflowFlowEdge> = useCallback((changes) => {
    setWorkflow((current) => {
      const connections: IConnection[] = [];
      for (const edge of applyEdgeChanges(changes, toFlowEdges(current.connections))) {
        if (edge.data !== undefined) connections.push(edge.data.connection);
      }
      return { ...current, connections };
    });
  }, []);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (connection.source === null || connection.target === null || connection.source === connection.target) return;
    const next: IConnection = { sourceNodeId: connection.source, targetNodeId: connection.target, outputIndex: indexFromHandle(connection.sourceHandle, "out"), inputIndex: indexFromHandle(connection.targetHandle, "in") };
    setWorkflow((current) => current.connections.some((edge) => connectionId(edge) === connectionId(next)) ? current : { ...current, connections: [...current.connections, next] });
  }, []);

  const persist = useCallback(async () => {
    setSaving(true);
    setSaveError(undefined);
    try { await saveWorkflow(workflow); }
    catch (error: unknown) { setSaveError(error instanceof Error ? error.message : "Unable to save workflow."); }
    finally { setSaving(false); }
  }, [workflow]);

  const beginTitleEdit = useCallback(() => { setTitleDraft(workflow.name); setIsEditingTitle(true); }, [workflow.name]);
  const commitTitle = useCallback(() => {
    const name = titleDraft.trim();
    if (name.length > 0 && name.length <= 255) setWorkflow((current) => ({ ...current, name }));
    else setTitleDraft(workflow.name);
    setIsEditingTitle(false);
  }, [titleDraft, workflow.name]);
  const cancelTitleEdit = useCallback(() => { setTitleDraft(workflow.name); setIsEditingTitle(false); }, [workflow.name]);

  return <section className="canvas-shell">
    <header>
      <div className="workflow-title" onDoubleClick={beginTitleEdit}>
        {isEditingTitle
          ? <><input aria-label="Workflow title" autoFocus value={titleDraft} maxLength={255} onChange={(event) => setTitleDraft(event.target.value)} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === "Enter") commitTitle(); if (event.key === "Escape") cancelTitleEdit(); }} /><button type="button" className="title-save" onMouseDown={(event) => event.preventDefault()} onClick={commitTitle}>Save title</button></>
          : <><h1 title="Double-click to rename">{workflow.name}</h1><button type="button" className="title-edit" aria-label="Edit workflow title" onClick={beginTitleEdit}>✎</button></>}
      </div>
      <div className="save-controls"><button type="button" disabled={saving} onClick={() => void persist()}>{saving ? "Saving…" : "Save workflow"}</button>{saveError !== undefined && <span role="alert">{saveError}</span>}</div>
    </header>
    <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge> nodes={nodes} edges={edges} nodeTypes={{ workflow: WorkflowNode }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView deleteKeyCode={["Backspace", "Delete"]}>
      <Background /><MiniMap /><Controls />
    </ReactFlow>
  </section>;
}
