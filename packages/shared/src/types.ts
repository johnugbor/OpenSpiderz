/** JSON-compatible values accepted by workflow definitions and executions. */
export type JsonPrimitive = string | number | boolean | null;
export interface IBinaryData { readonly dataId: string; readonly mimeType: string; readonly fileName: string; readonly fileSize: number; }
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue; }

export type NodeId = string;
export type WorkflowId = string;
export type ExecutionId = string;
export type ISODateTime = string;

export type NodeType = "trigger" | "regular";
export type NodeErrorPolicy = "stop" | "continue";
export interface INodePosition { readonly x: number; readonly y: number; }
export interface INodeCredentials { readonly [credentialType: string]: string; }

/** Immutable workflow-node definition. Credential values are references, never secrets. */
export interface INode {
  readonly id: NodeId;
  readonly name: string;
  readonly type: NodeType;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly position: INodePosition;
  readonly credentials: INodeCredentials;
  /** Whether the workflow may continue after this node fails. */
  readonly onError?: NodeErrorPolicy;
}

/** A directed edge from sourceNodeId/outputIndex to targetNodeId/inputIndex. */
export interface IConnection {
  readonly sourceNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly outputIndex: number;
  readonly inputIndex: number;
}

export interface IWorkflowSettings {
  readonly executionTimeoutMs?: number;
  readonly saveSuccessfulExecutions?: boolean;
  readonly saveFailedExecutions?: boolean;
  readonly timezone?: string;
}

export interface IWorkflow {
  readonly id: WorkflowId;
  readonly name: string;
  readonly nodes: readonly INode[];
  readonly connections: readonly IConnection[];
  readonly settings: IWorkflowSettings;
  readonly variables: Readonly<Record<string, JsonValue>>;
}

export type ExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type NodeExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

/** Auditable input/output record for exactly one node attempt. */
export interface INodeExecutionRecord {
  readonly nodeId: NodeId;
  readonly attempt: number;
  readonly status: NodeExecutionStatus;
  readonly startedAt?: ISODateTime;
  readonly finishedAt?: ISODateTime;
  readonly input: readonly JsonValue[];
  readonly output?: readonly JsonValue[];
  readonly error?: { readonly message: string; readonly code?: string; readonly details?: JsonValue };
}

/** Complete, append-only execution state. Payloads are JSON-safe for persistence. */
export interface IExecutionState {
  readonly id: ExecutionId;
  readonly workflowId: WorkflowId;
  readonly status: ExecutionStatus;
  readonly createdAt: ISODateTime;
  readonly startedAt?: ISODateTime;
  readonly finishedAt?: ISODateTime;
  readonly runningNodeIds: readonly NodeId[];
  readonly completedNodeIds: readonly NodeId[];
  readonly history: readonly INodeExecutionRecord[];
  /** Latest immutable execution record for every node that has been scheduled. */
  readonly nodeStates: Readonly<Record<NodeId, INodeExecutionRecord>>;
}
