import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type Node, type OnConnect, type OnEdgesChange, type OnNodesChange } from "@xyflow/react";
import { create } from "zustand";
import type { IConnection, INode, IWorkflow } from "@spiderz/shared";

export interface WorkflowNodeData extends Record<string, unknown> { readonly workflowNode: INode; readonly executionStatus?: string; }
export interface WorkflowEdgeData extends Record<string, unknown> { readonly connection: IConnection; }
export type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;
export type WorkflowFlowEdge = Edge<WorkflowEdgeData>;

const connectionId = (connection: IConnection): string => `${connection.sourceNodeId}:${connection.outputIndex}->${connection.targetNodeId}:${connection.inputIndex}`;
const indexFromHandle = (handle: string | null, prefix: "in" | "out"): number => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(handle ?? "")?.[1] ?? 0);
const toNodes = (nodes: readonly INode[]): WorkflowFlowNode[] => nodes.map((workflowNode) => ({ id: workflowNode.id, type: "workflow", position: workflowNode.position, data: { workflowNode } }));
const toEdges = (connections: readonly IConnection[]): WorkflowFlowEdge[] => connections.map((connection) => ({ id: connectionId(connection), source: connection.sourceNodeId, target: connection.targetNodeId, sourceHandle: `out-${connection.outputIndex}`, targetHandle: `in-${connection.inputIndex}`, type: "smoothstep", animated: true, style: { stroke: "#2563eb", strokeWidth: 3 }, data: { connection } }));

interface WorkflowCanvasStore {
  workflow?: IWorkflow;
  nodes: WorkflowFlowNode[];
  edges: WorkflowFlowEdge[];
  interactive: boolean;
  selectedNodeId: string | undefined;
  filePanelOpen: boolean;
  load: (workflow: IWorkflow) => void;
  updateWorkflow: (updater: (workflow: IWorkflow) => IWorkflow) => void;
  onNodesChange: OnNodesChange<WorkflowFlowNode>;
  onEdgesChange: OnEdgesChange<WorkflowFlowEdge>;
  onConnect: OnConnect;
  setInteractive: (interactive: boolean) => void;
  setSelectedNodeId: (nodeId: string | undefined) => void;
  setFilePanelOpen: (open: boolean) => void;
}

export const useWorkflowCanvasStore = create<WorkflowCanvasStore>((set, get) => ({
  nodes: [], edges: [], interactive: true, selectedNodeId: undefined, filePanelOpen: false,
  load: (workflow) => set({ workflow, nodes: toNodes(workflow.nodes), edges: toEdges(workflow.connections), interactive: true, selectedNodeId: undefined, filePanelOpen: false }),
  updateWorkflow: (updater) => set((state) => {
    if (state.workflow === undefined) return state;
    const workflow = updater(state.workflow);
    return { workflow, nodes: toNodes(workflow.nodes), edges: toEdges(workflow.connections) };
  }),
  onNodesChange: (changes) => set((state) => {
    if (state.workflow === undefined) return state;
    const nodes = applyNodeChanges(changes, state.nodes);
    const ids = new Set(nodes.map((node) => node.id));
    const workflowNodes = nodes.map((node) => ({ ...node.data.workflowNode, position: node.position }));
    const connections = state.workflow.connections.filter((connection) => ids.has(connection.sourceNodeId) && ids.has(connection.targetNodeId));
    return { nodes, edges: toEdges(connections), workflow: { ...state.workflow, nodes: workflowNodes, connections } };
  }),
  onEdgesChange: (changes) => set((state) => {
    if (state.workflow === undefined) return state;
    const edges = applyEdgeChanges(changes, state.edges);
    const connections = edges.flatMap((edge) => edge.data === undefined ? [] : [edge.data.connection]);
    return { edges, workflow: { ...state.workflow, connections } };
  }),
  onConnect: (connection: Connection) => set((state) => {
    if (state.workflow === undefined || connection.source === null || connection.target === null || connection.source === connection.target) return state;
    const next: IConnection = { sourceNodeId: connection.source, targetNodeId: connection.target, outputIndex: indexFromHandle(connection.sourceHandle, "out"), inputIndex: indexFromHandle(connection.targetHandle, "in") };
    if (state.workflow.connections.some((edge) => connectionId(edge) === connectionId(next))) return state;
    const flowEdge = toEdges([next])[0];
    if (flowEdge === undefined) return state;
    return { edges: addEdge(flowEdge, state.edges) as WorkflowFlowEdge[], workflow: { ...state.workflow, connections: [...state.workflow.connections, next] } };
  }),
  setInteractive: (interactive) => set({ interactive }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setFilePanelOpen: (filePanelOpen) => set({ filePanelOpen }),
}));
