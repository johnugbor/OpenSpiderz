import type {
  IConnection,
  IExecutionState,
  INode,
  INodeExecutionRecord,
  IWorkflow,
  JsonValue,
  NodeId,
} from "@spiderz/shared";
import { ExpressionParser } from "./expression-parser.js";

export class WorkflowValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowExecutionError extends Error {
  public constructor(
    message: string,
    public readonly execution: IExecutionState,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

/** Inputs are flattened for convenience and also retained by target input index. */
export interface INodeExecutionContext {
  readonly workflow: IWorkflow;
  readonly node: INode;
  readonly executionId: string;
  readonly input: readonly JsonValue[];
  readonly inputByIndex: ReadonlyMap<number, readonly JsonValue[]>;
  readonly signal: AbortSignal;
}

/** Implemented by concrete built-in and custom node handlers. */
export abstract class WorkflowNodeExecutor {
  public abstract execute(context: INodeExecutionContext): Promise<readonly JsonValue[]>;
}

export type NodeExecutorResolver = (node: INode) => WorkflowNodeExecutor | undefined;

export interface IWorkflowExecutionOptions {
  readonly executionId: string;
  readonly initialInput?: readonly JsonValue[];
  readonly signal?: AbortSignal;
  readonly onNodeComplete?: (record: INodeExecutionRecord, completedCount: number, totalNodes: number) => Promise<void> | void;
  readonly beforeNodeExecute?: (node: INode) => Promise<void> | void;
}

interface Graph {
  readonly nodesById: ReadonlyMap<NodeId, INode>;
  readonly incoming: ReadonlyMap<NodeId, readonly IConnection[]>;
  readonly outgoing: ReadonlyMap<NodeId, readonly IConnection[]>;
  readonly layers: readonly (readonly NodeId[])[];
}

/** Executes a validated workflow DAG, parallelising each topological layer. */
export class WorkflowExecutor {
  public constructor(private readonly resolveNodeExecutor: NodeExecutorResolver, private readonly expressionParser = new ExpressionParser()) {}

  public async execute(
    workflow: IWorkflow,
    options: IWorkflowExecutionOptions = { executionId: crypto.randomUUID() },
  ): Promise<IExecutionState> {
    const graph = this.buildGraph(workflow);
    const signal = options.signal ?? new AbortController().signal;
    const now = new Date().toISOString();
    const mutable = {
      status: "running" as IExecutionState["status"],
      createdAt: now,
      startedAt: now,
      finishedAt: undefined as string | undefined,
      runningNodeIds: new Set<NodeId>(),
      completedNodeIds: new Set<NodeId>(),
      history: [] as INodeExecutionRecord[],
      nodeStates: new Map<NodeId, INodeExecutionRecord>(),
      outputs: new Map<NodeId, readonly JsonValue[]>(),
    };

    for (const layer of graph.layers) {
      if (signal.aborted) {
        mutable.status = "cancelled";
        break;
      }
      const results = await Promise.all(layer.map(async (nodeId) => {
        const node = graph.nodesById.get(nodeId);
        if (node === undefined) throw new WorkflowValidationError(`Unknown node '${nodeId}'.`);
        const inputByIndex = this.resolveInputs(nodeId, graph.incoming, mutable.outputs, options.initialInput ?? []);
        const input = [...inputByIndex.values()].flat();
        mutable.runningNodeIds.add(nodeId);
        const startedAt = new Date().toISOString();
        try {
          await options.beforeNodeExecute?.(node);
          const evaluatedNode: INode = { ...node, parameters: await this.expressionParser.resolveParameters(node.parameters, { workflow, execution: this.snapshot(workflow, options.executionId, mutable), input }) };
          const executor = this.resolveNodeExecutor(evaluatedNode);
          if (executor === undefined) throw new Error(`No executor registered for node '${node.id}' (${node.name}).`);
          const output = await executor.execute({ workflow, node: evaluatedNode, executionId: options.executionId, input, inputByIndex, signal });
          const record: INodeExecutionRecord = { nodeId, attempt: 1, status: "succeeded", startedAt, finishedAt: new Date().toISOString(), input, output };
          return { nodeId, record, output, halt: false };
        } catch (caught: unknown) {
          const error = caught instanceof Error ? caught : new Error(String(caught));
          const record: INodeExecutionRecord = {
            nodeId, attempt: 1, status: signal.aborted ? "cancelled" : "failed", startedAt,
            finishedAt: new Date().toISOString(), input,
            error: { message: error.message, ...(error.stack === undefined ? {} : { details: error.stack }) },
          };
          return { nodeId, record, output: [] as readonly JsonValue[], halt: !signal.aborted && node.onError !== "continue" };
        }
      }));

      let shouldHalt = false;
      for (const result of results) {
        mutable.runningNodeIds.delete(result.nodeId);
        mutable.completedNodeIds.add(result.nodeId);
        mutable.history.push(result.record);
        mutable.nodeStates.set(result.nodeId, result.record);
        mutable.outputs.set(result.nodeId, result.output);
        await options.onNodeComplete?.(result.record, mutable.completedNodeIds.size, graph.nodesById.size);
        shouldHalt ||= result.halt;
      }
      if (shouldHalt) {
        mutable.status = "failed";
        break;
      }
    }

    if (mutable.status === "running") mutable.status = "succeeded";
    mutable.finishedAt = new Date().toISOString();
    const state = this.snapshot(workflow, options.executionId, mutable);
    if (state.status === "failed") throw new WorkflowExecutionError("Workflow execution failed.", state);
    return state;
  }

  private buildGraph(workflow: IWorkflow): Graph {
    const nodesById = new Map<NodeId, INode>();
    for (const node of workflow.nodes) {
      if (nodesById.has(node.id)) throw new WorkflowValidationError(`Duplicate node ID '${node.id}'.`);
      nodesById.set(node.id, node);
    }
    const incoming = new Map<NodeId, IConnection[]>();
    const outgoing = new Map<NodeId, IConnection[]>();
    const indegree = new Map<NodeId, number>();
    for (const id of nodesById.keys()) { incoming.set(id, []); outgoing.set(id, []); indegree.set(id, 0); }
    for (const edge of workflow.connections) {
      if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) throw new WorkflowValidationError(`Connection '${edge.sourceNodeId}' -> '${edge.targetNodeId}' references a missing node.`);
      if (!Number.isInteger(edge.inputIndex) || edge.inputIndex < 0 || !Number.isInteger(edge.outputIndex) || edge.outputIndex < 0) throw new WorkflowValidationError("Connection indexes must be non-negative integers.");
      incoming.get(edge.targetNodeId)?.push(edge);
      outgoing.get(edge.sourceNodeId)?.push(edge);
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }
    const remaining = new Map(indegree);
    let ready = [...remaining].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
    const layers: NodeId[][] = [];
    let visited = 0;
    while (ready.length > 0) {
      const layer = ready;
      layers.push(layer);
      ready = [];
      for (const id of layer) for (const edge of outgoing.get(id) ?? []) {
        const degree = (remaining.get(edge.targetNodeId) ?? 0) - 1;
        remaining.set(edge.targetNodeId, degree);
        if (degree === 0) ready.push(edge.targetNodeId);
      }
      ready.sort();
      visited += layer.length;
    }
    if (visited !== nodesById.size) throw new WorkflowValidationError("Workflow contains a directed cycle.");
    return { nodesById, incoming, outgoing, layers };
  }

  private resolveInputs(nodeId: NodeId, incoming: ReadonlyMap<NodeId, readonly IConnection[]>, outputs: ReadonlyMap<NodeId, readonly JsonValue[]>, initialInput: readonly JsonValue[]): ReadonlyMap<number, readonly JsonValue[]> {
    const grouped = new Map<number, JsonValue[]>();
    const edges = [...(incoming.get(nodeId) ?? [])].sort((a, b) => a.inputIndex - b.inputIndex || a.sourceNodeId.localeCompare(b.sourceNodeId) || a.outputIndex - b.outputIndex);
    if (edges.length === 0 && initialInput.length > 0) grouped.set(0, [...initialInput]);
    for (const edge of edges) {
      const values = outputs.get(edge.sourceNodeId) ?? [];
      const bucket = grouped.get(edge.inputIndex) ?? [];
      bucket.push(...values);
      grouped.set(edge.inputIndex, bucket);
    }
    return grouped;
  }

  private snapshot(workflow: IWorkflow, executionId: string, state: { readonly status: IExecutionState["status"]; readonly createdAt: string; readonly startedAt: string; readonly finishedAt: string | undefined; readonly runningNodeIds: ReadonlySet<NodeId>; readonly completedNodeIds: ReadonlySet<NodeId>; readonly history: readonly INodeExecutionRecord[]; readonly nodeStates: ReadonlyMap<NodeId, INodeExecutionRecord> }): IExecutionState {
    return { id: executionId, workflowId: workflow.id, status: state.status, createdAt: state.createdAt, startedAt: state.startedAt, ...(state.finishedAt === undefined ? {} : { finishedAt: state.finishedAt }), runningNodeIds: [...state.runningNodeIds], completedNodeIds: [...state.completedNodeIds], history: [...state.history], nodeStates: Object.fromEntries(state.nodeStates) };
  }
}
