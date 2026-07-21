import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";
import {
  Background,
  ControlButton,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { IBinaryData, IConnection, INode, IWorkflow, JsonObject, JsonValue } from "@spiderz/shared";
import { saveWorkflow } from "../api/workflows.js";
import { restore, version, versions } from "../api/versions.js";
import { executeWorkflow, execution, executions, subscribeExecutionProgress, type ExecutionNodeRecord, type ExecutionProgress } from "../api/executions.js";
import { credentials, type CredentialReference } from "../api/credentials.js";
import { binaryPreviewUrl, downloadBinary, uploadBinary } from "../api/binary.js";
import { useWorkflowCanvasStore } from "../stores/workflowCanvasStore.js";

interface WorkflowNodeData extends Record<string, unknown> { readonly workflowNode: INode; readonly executionStatus?: string; readonly onOpenFile?: (nodeId: string) => void; readonly onStartConnection?: (nodeId: string) => void; readonly onCompleteConnection?: (nodeId: string) => void; readonly connectionPending?: boolean; }
interface WorkflowEdgeData extends Record<string, unknown> { readonly connection: IConnection; }
type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;
type WorkflowFlowEdge = Edge<WorkflowEdgeData>;

export interface WorkflowCanvasProps { readonly initialWorkflow: IWorkflow; readonly onBack?: () => void; }

function connectionId(connection: IConnection): string {
  return `${connection.sourceNodeId}:${connection.outputIndex}->${connection.targetNodeId}:${connection.inputIndex}`;
}

function WorkflowNode({ data }: NodeProps<WorkflowFlowNode>): ReactElement {
  const node = data.workflowNode;
  const icon = node.type === "trigger" ? "⚡" : node.name === "Code" ? "⌘" : node.name === "HTTP Request" ? "↗" : node.name === "Postgres" ? "▦" : node.name === "Gmail" || node.name === "Outlook" ? "✉" : node.name === "Google Sheets" ? "▤" : "◈";
  return <div className={`workflow-node node-${data.executionStatus ?? "idle"}`}>
    {node.type !== "trigger" && <Handle type="target" position={Position.Left} id="in-0" title="Click to complete connection" onClick={(event) => { event.stopPropagation(); data.onCompleteConnection?.(node.id); }} />}
    <span className="workflow-node-icon" aria-hidden="true">{icon}</span><span className="workflow-node-copy"><strong>{node.name}</strong><small>{node.type === "trigger" ? "Trigger" : "Action"}</small></span><span className="workflow-node-status" aria-hidden="true"/>
    <Handle type="source" position={Position.Right} id="out-0" title="Drag or click to start connection" onClick={(event) => { event.stopPropagation(); data.onStartConnection?.(node.id); }} />
  </div>;
}

// React Flow treats nodeTypes as configuration. Keep this reference stable so a
// canvas state update does not cause React Flow to reinitialize itself.
const workflowNodeTypes = { workflow: WorkflowNode };

function ParameterJsonEditor({ node, onCommit, onClose }: { readonly node: INode; readonly onCommit: (parameters: Record<string, JsonValue>) => void; readonly onClose: () => void }): ReactElement {
  const [draft, setDraft] = useState(() => JSON.stringify(node.parameters, null, 2));
  const [error, setError] = useState<string>();
  useEffect(() => { setDraft(JSON.stringify(node.parameters, null, 2)); setError(undefined); }, [node.id]);
  return <aside className="node-json-editor" aria-label="Advanced JSON parameters"><div><strong>Advanced JSON</strong><button type="button" aria-label="Close advanced JSON editor" onClick={onClose}>×</button></div><textarea value={draft} spellCheck={false} onChange={(event) => { const next = event.target.value; setDraft(next); try { const parsed: unknown = JSON.parse(next); if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Parameters must be a JSON object."); onCommit(parsed as Record<string, JsonValue>); setError(undefined); } catch (parseError: unknown) { setError(parseError instanceof Error ? parseError.message : "Invalid JSON."); } }}/>{error !== undefined && <p role="alert">{error}</p>}</aside>;
}

function toFlowNodes(nodes: readonly INode[], statuses: ReadonlyMap<string,string>, onOpenFile: (nodeId: string) => void, onStartConnection: (nodeId: string) => void, onCompleteConnection: (nodeId: string) => void, pendingConnectionSourceId: string | undefined): WorkflowFlowNode[] {
  return nodes.map((node) => {
    const executionStatus = statuses.get(node.id);
    return {
      id: node.id,
      type: "workflow",
      position: node.position,
      data: executionStatus === undefined ? { workflowNode: node, onOpenFile, onStartConnection, onCompleteConnection, connectionPending: pendingConnectionSourceId === node.id } : { workflowNode: node, executionStatus, onOpenFile, onStartConnection, onCompleteConnection, connectionPending: pendingConnectionSourceId === node.id },
    };
  });
}
function toFlowEdges(connections: readonly IConnection[]): WorkflowFlowEdge[] {
  return connections.map((connection) => ({ id: connectionId(connection), source: connection.sourceNodeId, target: connection.targetNodeId, sourceHandle: `out-${connection.outputIndex}`, targetHandle: `in-${connection.inputIndex}`, type: "smoothstep", animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: "#2563eb" }, style: { stroke: "#2563eb", strokeWidth: 3 }, data: { connection } }));
}
function indexFromHandle(handle: string | null, prefix: "in" | "out"): number {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(handle ?? "");
  if (match?.[1] === undefined) return 0;
  return Number(match[1]);
}

interface WorkflowValidation { readonly errors: readonly string[]; readonly warnings: readonly string[]; }
function isBinaryData(value: JsonValue | undefined): value is JsonObject & IBinaryData { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.dataId === "string" && typeof value.fileName === "string" && typeof value.mimeType === "string" && typeof value.fileSize === "number"; }
export function validateWorkflow(workflow: IWorkflow): WorkflowValidation {
  const adjacent = new Map(workflow.nodes.map((node) => [node.id, [] as string[]]));
  const connected = new Set<string>();
  for (const connection of workflow.connections) { adjacent.get(connection.sourceNodeId)?.push(connection.targetNodeId); connected.add(connection.sourceNodeId); connected.add(connection.targetNodeId); }
  const visiting = new Set<string>(), visited = new Set<string>();
  const hasCycle = (nodeId: string): boolean => { if (visiting.has(nodeId)) return true; if (visited.has(nodeId)) return false; visiting.add(nodeId); const cycle = adjacent.get(nodeId)?.some(hasCycle) ?? false; visiting.delete(nodeId); visited.add(nodeId); return cycle; };
  const errors = workflow.nodes.some((node) => hasCycle(node.id)) ? ["This workflow contains a cycle."] : [];
  for (const node of workflow.nodes) {
    if (node.name.trim() === "") errors.push("Every node must have a name.");
    if (node.name === "HTTP Request" && (typeof node.parameters.url !== "string" || node.parameters.url.trim() === "")) errors.push("HTTP Request nodes require a URL.");
    if (node.name === "Code" && (typeof node.parameters.code !== "string" || node.parameters.code.trim() === "")) errors.push("Code nodes require code.");
    if (node.name === "Postgres" && (typeof node.parameters.query !== "string" || node.parameters.query.trim() === "")) errors.push("Postgres nodes require a query.");
    if (node.name === "Google Sheets" && (typeof node.parameters.spreadsheetId !== "string" || node.parameters.spreadsheetId.trim() === "")) errors.push("Google Sheets nodes require a spreadsheet ID.");
    if (node.name === "Gmail" && (typeof node.parameters.to !== "string" || node.parameters.to.trim() === "") && (typeof node.parameters.recipientField !== "string" || node.parameters.recipientField.trim() === "")) errors.push("Gmail nodes require a recipient or recipient field.");
  }
  const disconnected = workflow.nodes.filter((node) => workflow.nodes.length > 1 && !connected.has(node.id));
  const warnings = disconnected.length === 0 ? [] : [`${disconnected.length} node${disconnected.length === 1 ? " is" : "s are"} disconnected.`];
  if (workflow.nodes.length > 0 && !workflow.nodes.some((node) => node.type === "trigger")) warnings.push("No trigger node is configured.");
  return { errors, warnings };
}

export function WorkflowCanvas({ initialWorkflow, onBack }: WorkflowCanvasProps): ReactElement {
  const storedWorkflow = useWorkflowCanvasStore((state) => state.workflow);
  const loadCanvas = useWorkflowCanvasStore((state) => state.load);
  const updateCanvasWorkflow = useWorkflowCanvasStore((state) => state.updateWorkflow);
  const storeNodes = useWorkflowCanvasStore((state) => state.nodes);
  const storeEdges = useWorkflowCanvasStore((state) => state.edges);
  const storeOnNodesChange = useWorkflowCanvasStore((state) => state.onNodesChange);
  const storeOnEdgesChange = useWorkflowCanvasStore((state) => state.onEdgesChange);
  const storeOnConnect = useWorkflowCanvasStore((state) => state.onConnect);
  const canvasInteractive = useWorkflowCanvasStore((state) => state.interactive);
  const setCanvasInteractive = useWorkflowCanvasStore((state) => state.setInteractive);
  const workflow = storedWorkflow ?? initialWorkflow;
  const setWorkflow = useCallback((next: IWorkflow | ((workflow: IWorkflow) => IWorkflow)): void => updateCanvasWorkflow((current) => typeof next === "function" ? next(current) : next), [updateCanvasWorkflow]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialWorkflow.name);
  const [versionMessage, setVersionMessage] = useState("");
  const [history,setHistory]=useState<{id:string;version_number:number;created_at:string;immutable:boolean;restore_message?:string;message?:string;author_email:string}[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [inspectedVersion,setInspectedVersion]=useState<{id:string;versionNumber:number;workflow:IWorkflow}>();
  const [pendingRestore, setPendingRestore] = useState<{ id: string; versionNumber: number }>();
  const [runs,setRuns]=useState<{id:string;status:string;created_at:string}[]>([]);
  const [showRuns, setShowRuns] = useState(true);
  const [runFilter, setRunFilter] = useState<"all" | "queued" | "running" | "succeeded" | "failed" | "cancelled">("all");
  const [runDetail,setRunDetail]=useState<{history?:ExecutionNodeRecord[]}>();
  const selectedNodeId = useWorkflowCanvasStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useWorkflowCanvasStore((state) => state.setSelectedNodeId);
  const [undoStack, setUndoStack] = useState<IWorkflow[]>([]);
  const [redoStack, setRedoStack] = useState<IWorkflow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [runningWorkflow, setRunningWorkflow] = useState(false);
  const [runError, setRunError] = useState<string>();
  const [executionInput, setExecutionInput] = useState("[]");
  const [showTestInput, setShowTestInput] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"nodes" | "actions" | undefined>();
  const [showParameterEditor, setShowParameterEditor] = useState(false);
  const showNodeFile = useWorkflowCanvasStore((state) => state.filePanelOpen);
  const setShowNodeFile = useWorkflowCanvasStore((state) => state.setFilePanelOpen);
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = useState<string>();
  const [liveExecutionId, setLiveExecutionId] = useState<string>();
  const [liveProgress, setLiveProgress] = useState<ReadonlyMap<string, ExecutionProgress>>(new Map());
  const [credentialOptions, setCredentialOptions] = useState<CredentialReference[]>([]);
  const [uploadingBinary, setUploadingBinary] = useState(false);
  const [binaryError, setBinaryError] = useState<string>();
  const [binaryPreview, setBinaryPreview] = useState<string>();
  const [nodeSearch, setNodeSearch] = useState("");
  const [dismissedValidation, setDismissedValidation] = useState<string>();
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<WorkflowFlowNode, WorkflowFlowEdge>>();
  const [flowEdges, setFlowEdges] = useState<WorkflowFlowEdge[]>(() => toFlowEdges(initialWorkflow.connections));
  const nodeSearchInput = useRef<HTMLInputElement>(null);
  const workflowImportInput = useRef<HTMLInputElement>(null);
  const binaryUploadInput = useRef<HTMLInputElement>(null);
  const lastWorkflow = useRef(initialWorkflow);
  const lastFittedNodeCount = useRef(0);
  const lastSavedDefinition = useRef(JSON.stringify(initialWorkflow));
  const applyingHistory = useRef(false);
  const selectedNode=workflow.nodes.find(node=>node.id===selectedNodeId);
  const selectedBinary = selectedNode !== undefined && isBinaryData(selectedNode.parameters.binaryData) ? selectedNode.parameters.binaryData : undefined;
  const webhookUrl = selectedNode?.parameters.triggerKind === "webhook" ? `${import.meta.env.VITE_WEBHOOK_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"}/webhook/${workflow.id}/${selectedNode.id}` : undefined;
  const formUrl = selectedNode?.parameters.triggerKind === "form" ? `${import.meta.env.VITE_WEBHOOK_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"}/form/${workflow.id}/${selectedNode.id}` : undefined;
  useEffect(() => { applyingHistory.current = true; lastWorkflow.current = initialWorkflow; lastFittedNodeCount.current = 0; lastSavedDefinition.current = JSON.stringify(initialWorkflow); setDirty(false); setUndoStack([]); setRedoStack([]); loadCanvas(initialWorkflow); setFlowEdges(toFlowEdges(initialWorkflow.connections)); setTitleDraft(initialWorkflow.name); }, [initialWorkflow, loadCanvas]);
  useEffect(() => {
    if (applyingHistory.current) { applyingHistory.current = false; lastWorkflow.current = workflow; return; }
    if (lastWorkflow.current !== workflow) { setUndoStack((history) => [...history, lastWorkflow.current].slice(-50)); setRedoStack([]); lastWorkflow.current = workflow; }
  }, [workflow]);
  const statuses=useMemo(()=>new Map([... (runDetail?.history?.map(item=>[item.nodeId,item.status] as const)??[]), ...[...liveProgress.values()].map(item=>[item.nodeId,item.status] as const)]),[runDetail,liveProgress]);
  const liveProgressItems = useMemo(() => [...liveProgress.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)), [liveProgress]);
  const liveProgressSummary = liveProgressItems.at(-1);
  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const selectedNodeErrors = useMemo(() => selectedNode === undefined ? [] : validation.errors.filter((message) => (message === "Every node must have a name." && selectedNode.name.trim() === "") || (message === "HTTP Request nodes require a URL." && selectedNode.name === "HTTP Request") || (message === "Code nodes require code." && selectedNode.name === "Code") || (message === "Postgres nodes require a query." && selectedNode.name === "Postgres") || (message === "Google Sheets nodes require a spreadsheet ID." && selectedNode.name === "Google Sheets") || (message === "Gmail nodes require a recipient or recipient field." && selectedNode.name === "Gmail")), [selectedNode, validation.errors]);
  const validationKey = useMemo(() => JSON.stringify([validation.errors, validation.warnings]), [validation]);
  const workflowDefinition = useMemo(() => JSON.stringify(workflow), [workflow]);
  useEffect(() => { setDirty(workflowDefinition !== lastSavedDefinition.current); }, [workflowDefinition]);
  const openNodeFile = useCallback((nodeId: string): void => { setSelectedNodeId(nodeId); setShowNodeFile(true); }, []);
  const startConnection = useCallback((nodeId: string): void => { setPendingConnectionSourceId(nodeId); }, []);
  const completeConnection = useCallback((targetNodeId: string): void => { if (pendingConnectionSourceId === undefined || pendingConnectionSourceId === targetNodeId) { setPendingConnectionSourceId(undefined); return; } const next: IConnection = { sourceNodeId: pendingConnectionSourceId, targetNodeId, outputIndex: 0, inputIndex: 0 }; setWorkflow((current) => current.connections.some((edge) => connectionId(edge) === connectionId(next)) ? current : { ...current, connections: [...current.connections, next] }); setPendingConnectionSourceId(undefined); }, [pendingConnectionSourceId]);
  const selectCanvasNode = useCallback((nodeId: string): void => { if (pendingConnectionSourceId !== undefined) { completeConnection(nodeId); return; } setSelectedNodeId(nodeId); }, [completeConnection, pendingConnectionSourceId]);
  const nodes = storeNodes;
  useEffect(() => { setFlowEdges(toFlowEdges(workflow.connections)); }, [workflow.connections]);
  const matchingNodes = useMemo(() => nodeSearch.trim() === "" ? [] : workflow.nodes.filter((node) => node.name.toLowerCase().includes(nodeSearch.trim().toLowerCase())), [workflow.nodes, nodeSearch]);
  const focusNode = useCallback((nodeId: string): void => { setSelectedNodeId(nodeId); const flowNode = nodes.find((node) => node.id === nodeId); if (flowNode !== undefined) void flowInstance?.fitView({ nodes: [flowNode], duration: 300, padding: 0.8 }); }, [nodes, flowInstance]);

  const onNodesChange: OnNodesChange<WorkflowFlowNode> = useCallback((changes) => {
    setWorkflow((current) => {
      const nextNodes = applyNodeChanges(changes, toFlowNodes(current.nodes,statuses,openNodeFile,startConnection,completeConnection,pendingConnectionSourceId));
      const remainingIds = new Set(nextNodes.map((node) => node.id));
      return { ...current, nodes: nextNodes.map((node) => ({ ...node.data.workflowNode, position: node.position })), connections: current.connections.filter((edge) => remainingIds.has(edge.sourceNodeId) && remainingIds.has(edge.targetNodeId)) };
    });
  }, [completeConnection, openNodeFile, pendingConnectionSourceId, startConnection, statuses]);

  const onEdgesChange: OnEdgesChange<WorkflowFlowEdge> = useCallback((changes) => {
    setFlowEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
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
    setPendingConnectionSourceId(undefined);
    const flowEdge = toFlowEdges([next])[0];
    if (flowEdge !== undefined) setFlowEdges((currentEdges) => addEdge(flowEdge, currentEdges) as WorkflowFlowEdge[]);
    setWorkflow((current) => current.connections.some((edge) => connectionId(edge) === connectionId(next)) ? current : { ...current, connections: [...current.connections, next] });
  }, []);

  const persist = useCallback(async (autosave = false) => {
    if (validation.errors.length > 0) { setSaveError(validation.errors.join(" ")); return; }
    setSaving(true);
    setSaveError(undefined);
    try { await saveWorkflow(workflow, undefined, autosave, autosave ? undefined : versionMessage); lastSavedDefinition.current = JSON.stringify(workflow); setDirty(false); if (!autosave) setVersionMessage(""); }
    catch (error: unknown) { setSaveError(error instanceof Error ? error.message : "Unable to save workflow."); }
    finally { setSaving(false); }
  }, [workflow, validation.errors, versionMessage]);

  useEffect(() => { if (!dirty || saving || validation.errors.length > 0) return; const timer = window.setTimeout(() => void persist(true), 1_000); return () => window.clearTimeout(timer); }, [dirty, saving, validation.errors.length, persist]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent): void => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [dirty]);

  const undo = useCallback(() => { const previous = undoStack.at(-1); if (previous === undefined) return; applyingHistory.current = true; setUndoStack((history) => history.slice(0, -1)); setRedoStack((history) => [...history, workflow]); setWorkflow(previous); }, [undoStack, workflow]);
  const redo = useCallback(() => { const next = redoStack.at(-1); if (next === undefined) return; applyingHistory.current = true; setRedoStack((history) => history.slice(0, -1)); setUndoStack((history) => [...history, workflow]); setWorkflow(next); }, [redoStack, workflow]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent): void => { const target = event.target; const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; } if (!editingText && event.key === "/") { event.preventDefault(); nodeSearchInput.current?.focus(); return; } if (!editingText && event.key === "Escape") setSelectedNodeId(undefined); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [undo, redo]);

  const beginTitleEdit = useCallback(() => { setTitleDraft(workflow.name); setIsEditingTitle(true); }, [workflow.name]);
  const commitTitle = useCallback(() => {
    const name = titleDraft.trim();
    if (name.length > 0 && name.length <= 255) setWorkflow((current) => ({ ...current, name }));
    else setTitleDraft(workflow.name);
    setIsEditingTitle(false);
  }, [titleDraft, workflow.name]);
  const cancelTitleEdit = useCallback(() => { setTitleDraft(workflow.name); setIsEditingTitle(false); }, [workflow.name]);
  const loadHistory=():void=>{ setShowHistory(true); void versions(workflow.id).then(setHistory).catch(()=>setHistory([])); };
  const confirmRestore = (): void => { if (pendingRestore === undefined) return; void restore(workflow.id, pendingRestore.id).then((saved) => { setWorkflow(saved); setPendingRestore(undefined); setInspectedVersion(undefined); loadHistory(); }).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : "Could not restore version.")); };
  const refreshRuns=()=>void executions(workflow.id).then(setRuns).catch(()=>setRuns([]));
  const loadRuns=():void=>{ setShowRuns(true); refreshRuns(); };
  const runWorkflow = (): void => { let input: JsonValue[]; try { const parsed: unknown = JSON.parse(executionInput); if (!Array.isArray(parsed)) throw new Error("Test input must be a JSON array."); input = parsed as JsonValue[]; } catch (error: unknown) { setRunError(error instanceof Error ? error.message : "Test input must be valid JSON."); return; } setRunningWorkflow(true); setRunError(undefined); void executeWorkflow(workflow.id, input).then((queued) => { setLiveExecutionId(queued.executionId); setLiveProgress(new Map()); loadRuns(); }).catch((error: unknown) => setRunError(error instanceof Error ? error.message : "Could not queue workflow.")).finally(() => setRunningWorkflow(false)); };
  const exportWorkflow = (): void => { const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${workflow.name.replaceAll(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "workflow"}.json`; link.click(); URL.revokeObjectURL(url); };
  const importWorkflow = (event: ChangeEvent<HTMLInputElement>): void => { const file = event.target.files?.[0]; event.target.value = ""; if (file === undefined) return; void file.text().then((text) => { const parsed: unknown = JSON.parse(text); if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Partial<IWorkflow>).nodes) || !Array.isArray((parsed as Partial<IWorkflow>).connections) || typeof (parsed as Partial<IWorkflow>).name !== "string") throw new Error("This is not a valid workflow JSON file."); const imported = parsed as IWorkflow; setWorkflow({ ...imported, id: workflow.id }); setTitleDraft(imported.name); }).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : "Could not import workflow.")); };
  const uploadForSelectedNode = (event: ChangeEvent<HTMLInputElement>): void => { const file = event.target.files?.[0]; event.target.value = ""; if (file === undefined || selectedNode === undefined) return; setUploadingBinary(true); setBinaryError(undefined); void uploadBinary(file).then((reference) => setWorkflow((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, parameters: { ...node.parameters, binaryData: reference as unknown as JsonValue } } : node) }))).catch((error: unknown) => setBinaryError(error instanceof Error ? error.message : "Could not upload file.")).finally(() => setUploadingBinary(false)); };
  const addNode=(name:string,type:"trigger"|"regular",parameters:Record<string,JsonValue>={})=>setWorkflow(current=>({...current,nodes:[...current.nodes,{id:crypto.randomUUID(),name,type,parameters,position:{x:160+current.nodes.length*40,y:160+current.nodes.length*40},credentials:{}}]}));
  const startNodeDrag = (event: DragEvent<HTMLButtonElement>, name: string, type: "trigger" | "regular", parameters: Record<string, JsonValue>): void => { event.dataTransfer.setData("application/x-spiderz-node", JSON.stringify({ name, type, parameters })); event.dataTransfer.effectAllowed = "move"; };
  const paletteNodes: readonly { readonly label: string; readonly name: string; readonly type: "trigger" | "regular"; readonly parameters: Record<string, JsonValue> }[] = [
    { label: "Webhook", name: "Webhook", type: "trigger", parameters: { triggerKind: "webhook" } },
    { label: "Form Trigger", name: "Form Trigger", type: "trigger", parameters: { triggerKind: "form", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "message", label: "Message", type: "textarea", required: true }] } },
    { label: "HTTP Request", name: "HTTP Request", type: "regular", parameters: { method: "GET", url: "", responseFormat: "json" } },
    { label: "Code", name: "Code", type: "regular", parameters: { code: "return $input;", language: "javascript" } },
    { label: "Postgres", name: "Postgres", type: "regular", parameters: { operation: "query", query: "" } },
    { label: "Google Sheets", name: "Google Sheets", type: "regular", parameters: { spreadsheetId: "", range: "Sheet1!A:Z" } },
    { label: "Google Drive", name: "Google Drive", type: "regular", parameters: { fileName: "workflow-output.txt", contentField: "reply", folderId: "" } },
    { label: "Gmail", name: "Gmail", type: "regular", parameters: { to: "", recipientField: "email", subject: "We received your enquiry", body: "", bodyField: "reply" } },
    { label: "Slack", name: "Slack", type: "regular", parameters: { channel: "", text: "", textField: "reply" } },
    { label: "Telegram", name: "Telegram", type: "regular", parameters: { chatId: "", text: "", textField: "reply" } },
    { label: "Notion", name: "Notion", type: "regular", parameters: { parentPageId: "", titleField: "name", bodyField: "reply" } },
    { label: "Airtable", name: "Airtable", type: "regular", parameters: { baseId: "", table: "" } },
    { label: "Outlook", name: "Outlook", type: "regular", parameters: { to: "", recipientField: "email", subject: "We received your enquiry", body: "", bodyField: "reply" } },
    { label: "File Input", name: "File Input", type: "regular", parameters: { binaryData: null } },
  ];
  const dropNode = (event: DragEvent): void => { event.preventDefault(); const raw = event.dataTransfer.getData("application/x-spiderz-node"); if (raw === "") return; try { const node = JSON.parse(raw) as { name: string; type: "trigger" | "regular"; parameters: Record<string, JsonValue> }; const position = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 200, y: 200 }; setWorkflow((current) => ({ ...current, nodes: [...current.nodes, { id: crypto.randomUUID(), name: node.name, type: node.type, parameters: node.parameters, position, credentials: {} }] })); window.setTimeout(() => { void flowInstance?.setCenter(position.x, position.y, { zoom: 1.1, duration: 250 }); }, 50); } catch { setSaveError("Could not add the dropped node."); } };
  useEffect(() => { refreshRuns(); const timer = setInterval(refreshRuns, 5_000); return () => clearInterval(timer); }, [workflow.id]);
  useEffect(() => { if (liveExecutionId === undefined) return; return subscribeExecutionProgress(workflow.id, liveExecutionId, (progress) => { if (["succeeded", "failed", "cancelled"].includes(progress.status)) { setLiveExecutionId(undefined); loadRuns(); return; } setLiveProgress((current) => new Map(current).set(progress.nodeId, progress)); if (progress.completed >= progress.total) { setLiveExecutionId(undefined); loadRuns(); } }); }, [workflow.id, liveExecutionId]);
  useEffect(() => { if (liveExecutionId === undefined) return; let disposed = false; const check = (): void => { void execution(liveExecutionId).then((result) => { if (!disposed && ["succeeded", "failed", "cancelled"].includes(result.state.status ?? "")) { setLiveExecutionId(undefined); loadRuns(); } }).catch(() => undefined); }; check(); const timer = window.setInterval(check, 2_000); return () => { disposed = true; window.clearInterval(timer); }; }, [liveExecutionId]);
  useEffect(() => { if (flowInstance === undefined || nodes.length === 0) return; if (nodes.length > lastFittedNodeCount.current) window.setTimeout(() => { void flowInstance.fitView({ nodes, padding: 0.35, duration: 250 }); }, 50); lastFittedNodeCount.current = nodes.length; }, [flowInstance, nodes]);
  useEffect(() => { void credentials().then(setCredentialOptions).catch(() => setCredentialOptions([])); }, []);
  useEffect(() => { if (selectedBinary === undefined || !selectedBinary.mimeType.startsWith("image/")) { setBinaryPreview(undefined); return; } let active = true; let objectUrl: string | undefined; void binaryPreviewUrl(selectedBinary).then((url) => { objectUrl = url; if (active) setBinaryPreview(url); else URL.revokeObjectURL(url); }).catch((error: unknown) => setBinaryError(error instanceof Error ? error.message : "Could not load image preview.")); return () => { active = false; if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl); }; }, [selectedBinary?.dataId]);
  useEffect(() => { setShowNodeFile(selectedNode?.name === "File Input"); }, [selectedNode?.id, selectedNode?.name, setShowNodeFile]);

  return <section className="canvas-shell">
    <header>
      <div className="workflow-title" onDoubleClick={beginTitleEdit}>
        {isEditingTitle
          ? <><input aria-label="Workflow title" autoFocus value={titleDraft} maxLength={255} onChange={(event) => setTitleDraft(event.target.value)} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === "Enter") commitTitle(); if (event.key === "Escape") cancelTitleEdit(); }} /><button type="button" className="title-save" onMouseDown={(event) => event.preventDefault()} onClick={commitTitle}>Save title</button></>
          : <><h1 title="Double-click to rename">{workflow.name}</h1><button type="button" className="title-edit" aria-label="Edit workflow title" onClick={beginTitleEdit}>✎</button></>}
      </div>
      <div className="save-controls">{onBack !== undefined && <button type="button" onClick={onBack}>Back</button>}<button type="button" onClick={loadHistory}>Versions</button><button type="button" onClick={loadRuns}>Runs</button><input className="version-message" aria-label="Version message" placeholder="Version message (optional)" value={versionMessage} maxLength={500} onChange={(event) => setVersionMessage(event.target.value)}/><button type="button" disabled={saving} onClick={() => void persist()}>{saving ? "Saving…" : "Save workflow"}</button>{saveError !== undefined && <span role="alert">{saveError}</span>}</div>
    </header>
    <div className="mobile-studio-bar" aria-label="Mobile studio controls"><button type="button" aria-expanded={mobilePanel === "nodes"} onClick={() => setMobilePanel((current) => current === "nodes" ? undefined : "nodes")}>☷ Nodes</button><button type="button" aria-expanded={mobilePanel === "actions"} onClick={() => setMobilePanel((current) => current === "actions" ? undefined : "actions")}>⋯ Actions</button></div>
    {mobilePanel === "actions" && <aside className="mobile-action-sheet" aria-label="Workflow actions"><div><strong>Workflow actions</strong><button type="button" aria-label="Close actions" onClick={() => setMobilePanel(undefined)}>×</button></div><button type="button" onClick={() => { setShowTestInput(true); setMobilePanel(undefined); }}>⌘ Test input</button><button className="mobile-save" type="button" disabled={saving} onClick={() => { void persist(); setMobilePanel(undefined); }}>{saving ? "Saving…" : "✓ Save workflow"}</button><button className="mobile-run" type="button" disabled={runningWorkflow || validation.errors.length > 0} onClick={() => { runWorkflow(); setMobilePanel(undefined); }}>{runningWorkflow ? "Queueing…" : "▶ Run workflow"}</button><button type="button" onClick={() => { exportWorkflow(); setMobilePanel(undefined); }}>⇩ Export workflow</button><button type="button" onClick={() => { workflowImportInput.current?.click(); setMobilePanel(undefined); }}>⇧ Import workflow</button><button type="button" disabled={undoStack.length === 0} onClick={() => { undo(); setMobilePanel(undefined); }}>↶ Undo</button><button type="button" disabled={redoStack.length === 0} onClick={() => { redo(); setMobilePanel(undefined); }}>↷ Redo</button><button type="button" onClick={() => { loadRuns(); setMobilePanel(undefined); }}>◷ Runs</button><button type="button" onClick={() => { loadHistory(); setMobilePanel(undefined); }}>◫ Versions</button></aside>}
    <div className="history-controls">{dirty && <span className="unsaved-indicator">Unsaved changes</span>}<button className="test-input-toggle" type="button" aria-label="Open test input" title="Test input" onClick={() => setShowTestInput(true)}>⌘</button><button type="button" disabled={runningWorkflow || validation.errors.length > 0} onClick={runWorkflow}>{runningWorkflow ? "Queueing..." : "Run workflow"}</button><button type="button" onClick={exportWorkflow}>Export</button><button type="button" onClick={() => workflowImportInput.current?.click()}>Import</button><button type="button" disabled={undoStack.length === 0} onClick={undo}>Undo</button><button type="button" disabled={redoStack.length === 0} onClick={redo}>Redo</button>{runError !== undefined && <span className="run-error" role="alert">{runError}</span>}</div>
    <input ref={workflowImportInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importWorkflow}/>
    <input ref={binaryUploadInput} className="visually-hidden" type="file" onChange={uploadForSelectedNode}/>
    {selectedNode !== undefined && showNodeFile && <aside className="binary-controls"><div className="binary-controls-title"><strong>Node file</strong><button type="button" className="binary-close" aria-label="Close node file panel" title="Close" onClick={() => setShowNodeFile(false)}>×</button></div><button type="button" disabled={uploadingBinary} onClick={() => binaryUploadInput.current?.click()}>{uploadingBinary ? "Uploading..." : "Upload file"}</button>{selectedBinary !== undefined && <><small>{selectedBinary.fileName} ({selectedBinary.fileSize} bytes)</small>{binaryPreview !== undefined && <img src={binaryPreview} alt={`Preview of ${selectedBinary.fileName}`}/>}<button type="button" onClick={() => void downloadBinary(selectedBinary).catch((error: unknown) => setBinaryError(error instanceof Error ? error.message : "Could not download file."))}>Download</button></>}{binaryError !== undefined && <small role="alert">{binaryError}</small>}</aside>}
    <aside className={`node-palette${mobilePanel === "nodes" ? " mobile-open" : ""}`}><div className="palette-heading"><span><strong>Add node</strong><small>Drag onto canvas or click</small></span><button className="palette-close" type="button" aria-label="Close node palette" onClick={() => setMobilePanel(undefined)}>×</button></div>{paletteNodes.map((template) => <button key={template.name} draggable onDragStart={(event) => startNodeDrag(event, template.name, template.type, template.parameters)} onClick={() => addNode(template.name, template.type, template.parameters)}>{template.label}</button>)}</aside>
    <aside className="node-search"><input ref={nodeSearchInput} aria-label="Find node" placeholder="Find node (/ )" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)}/>{matchingNodes.map((node) => <button type="button" key={node.id} onClick={() => { focusNode(node.id); setNodeSearch(""); }}>{node.name}</button>)}</aside>
    {showTestInput && <aside className="execution-input"><div><label htmlFor="execution-input">Test input (JSON array)</label><button type="button" aria-label="Close test input" onClick={() => setShowTestInput(false)}>×</button></div><textarea id="execution-input" value={executionInput} onChange={(event) => setExecutionInput(event.target.value)} /></aside>}
    {liveExecutionId!==undefined&&<aside className="live-execution" aria-live="polite"><strong>Workflow running</strong><span>{liveProgressSummary===undefined ? "Starting…" : `${liveProgressSummary.completed} of ${liveProgressSummary.total} nodes complete`}</span><progress value={liveProgressSummary?.completed ?? 0} max={liveProgressSummary?.total ?? Math.max(workflow.nodes.length,1)}/>{liveProgressItems.map((progress)=><small key={progress.nodeId}>{workflow.nodes.find((node)=>node.id===progress.nodeId)?.name??progress.nodeId}: {progress.status}</small>)}</aside>}
    {(validation.errors.length > 0 || validation.warnings.length > 0) && dismissedValidation !== validationKey && <aside className="workflow-validation" aria-live="polite"><button type="button" className="validation-close" aria-label="Dismiss workflow validation" title="Dismiss" onClick={() => setDismissedValidation(validationKey)}>×</button>{validation.errors.map((message, index) => <p className="validation-error" key={`error-${index}-${message}`}>{message}</p>)}{validation.warnings.map((message, index) => <p className="validation-warning" key={`warning-${index}-${message}`}>{message}</p>)}</aside>}
    {formUrl !== undefined && <aside className="form-trigger-url"><strong>Public form URL</strong><input readOnly value={formUrl}/><button type="button" onClick={() => void navigator.clipboard.writeText(formUrl)}>Copy URL</button><a href={formUrl} target="_blank" rel="noreferrer">Open form</a><small>Save and enable the workflow before sharing.</small></aside>}
    {showHistory&&history.length>0&&<aside className="versions"><button type="button" className="versions-close" aria-label="Close versions panel" title="Close" onClick={() => setShowHistory(false)}>×</button>{history.map(v=><div key={v.id}><button title={`By ${v.author_email} on ${new Date(v.created_at).toLocaleString()}${v.message === undefined ? "" : `: ${v.message}`}${v.restore_message === undefined ? "" : `: ${v.restore_message}`}`} onClick={()=>void version(workflow.id,v.id).then((saved) => setInspectedVersion({ id: v.id, versionNumber: v.version_number, workflow: saved }))}>Inspect v{v.version_number}</button><small>{v.author_email}{v.message === undefined ? "" : ` · ${v.message}`}{v.restore_message === undefined ? "" : ` · ${v.restore_message}`}</small><button disabled={v.immutable} onClick={()=>setPendingRestore({id:v.id,versionNumber:v.version_number})} >Restore</button></div>)}</aside>}
    {inspectedVersion !== undefined && <aside className="version-detail"><button type="button" onClick={() => setInspectedVersion(undefined)}>Close</button><h3>Version {inspectedVersion.versionNumber}</h3><p>{inspectedVersion.workflow.name}</p><small>{inspectedVersion.workflow.nodes.length} nodes · {inspectedVersion.workflow.connections.length} connections</small><button type="button" onClick={() => setPendingRestore({ id: inspectedVersion.id, versionNumber: inspectedVersion.versionNumber })}>Restore this version</button></aside>}
    {pendingRestore !== undefined && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="restore-version-title"><h2 id="restore-version-title">Restore version {pendingRestore.versionNumber}?</h2><p>Your current development draft will be replaced. A new restore version will be recorded.</p><div><button onClick={() => setPendingRestore(undefined)}>Cancel</button><button onClick={confirmRestore}>Restore version</button></div></section></div>}
    {showRuns&&runs.length>0&&<aside className="runs"><button type="button" className="runs-close" aria-label="Close runs panel" title="Close" onClick={() => setShowRuns(false)}>×</button><select aria-label="Execution status filter" value={runFilter} onChange={(event) => setRunFilter(event.target.value as typeof runFilter)}><option value="all">All runs</option><option value="failed">Failed</option><option value="running">Running</option><option value="queued">Queued</option><option value="succeeded">Succeeded</option><option value="cancelled">Cancelled</option></select>{runs.filter((run) => runFilter === "all" || run.status === runFilter).map(run=><button className={`run run-${run.status}`} key={run.id} onClick={()=>void execution(run.id).then(detail=>setRunDetail(detail.state))}>{run.status} · {new Date(run.created_at).toLocaleString()}</button>)}</aside>}
    {runDetail!==undefined&&<aside className="run-detail"><button type="button" onClick={() => setRunDetail(undefined)}>Close</button>{runDetail.history?.map(item=>{const nodeName=workflow.nodes.find((node)=>node.id===item.nodeId)?.name??item.nodeId;return <section key={item.nodeId} className="execution-step"><p><strong>{nodeName}</strong>: {item.status}{item.input===undefined?"":` · in ${item.input.length}`}{item.output===undefined?"":` · out ${item.output.length}`}{item.error===undefined?"":` — ${item.error.message}`}</p>{item.input!==undefined&&<details><summary>Input payload</summary><pre>{JSON.stringify(item.input,null,2)}</pre></details>}{item.output!==undefined&&<details><summary>Output payload</summary><pre>{JSON.stringify(item.output,null,2)}</pre></details>}{item.error?.details!==undefined&&<details><summary>Error details{item.error.code===undefined?"":` (${item.error.code})`}</summary><pre>{JSON.stringify(item.error.details,null,2)}</pre></details>}</section>;})}</aside>}
    {runError!==undefined&&<aside className="run-error-toast" role="alert"><span>{runError}</span><button type="button" aria-label="Dismiss run error" onClick={() => setRunError(undefined)}>×</button></aside>}
    <div className="canvas-flow" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={dropNode}>
    <ReactFlow<WorkflowFlowNode, WorkflowFlowEdge> className={pendingConnectionSourceId === undefined ? undefined : "connection-pending"} nodes={nodes} edges={storeEdges} nodeTypes={workflowNodeTypes} onInit={setFlowInstance} onNodesChange={storeOnNodesChange} onEdgesChange={storeOnEdgesChange} onConnect={storeOnConnect} onNodeClick={(_,node)=>selectCanvasNode(node.id)} nodesDraggable={canvasInteractive} nodesConnectable={canvasInteractive} elementsSelectable={canvasInteractive} fitView deleteKeyCode={canvasInteractive ? ["Backspace", "Delete"] : null}>
      <Background /><MiniMap /><Controls showZoom={false} showFitView={false} showInteractive={false} aria-label="Canvas controls"><ControlButton title="Zoom in" aria-label="Zoom in" onClick={() => void flowInstance?.zoomIn({ duration: 150 })}>+ Zoom</ControlButton><ControlButton title="Zoom out" aria-label="Zoom out" onClick={() => void flowInstance?.zoomOut({ duration: 150 })}>− Zoom</ControlButton><ControlButton title="Fit all nodes in view" aria-label="Fit all nodes in view" onClick={() => void flowInstance?.fitView({ nodes, padding: 0.35, duration: 250 })}>Fit</ControlButton><ControlButton title={canvasInteractive ? "Lock canvas" : "Unlock canvas"} aria-label={canvasInteractive ? "Lock canvas" : "Unlock canvas"} onClick={() => setCanvasInteractive(!canvasInteractive)}>{canvasInteractive ? "Lock" : "Unlock"}</ControlButton></Controls>
    </ReactFlow>
    </div>
    {selectedNode!==undefined&&selectedNodeErrors.length>0&&<aside className="node-settings-errors" role="alert"><strong>Fix this node</strong>{selectedNodeErrors.map((message,index)=><p key={`${index}-${message}`}>{message}</p>)}</aside>}
    {selectedNode!==undefined&&<button type="button" className="node-json-toggle" onClick={() => setShowParameterEditor(true)}>Advanced JSON</button>}
    {selectedNode!==undefined&&showParameterEditor&&<ParameterJsonEditor node={selectedNode} onClose={() => setShowParameterEditor(false)} onCommit={(parameters) => setWorkflow((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, parameters } : node) }))}/>} 
    {selectedNode!==undefined&&<button type="button" className="node-settings-close" aria-label="Close node settings" title="Close" onClick={() => { setSelectedNodeId(undefined); setShowNodeFile(false); }}>×</button>}
    {selectedNode!==undefined&&<button type="button" className="node-delete" title="Delete this node and its connections" onClick={() => { setWorkflow((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selectedNode.id), connections: current.connections.filter((connection) => connection.sourceNodeId !== selectedNode.id && connection.targetNodeId !== selectedNode.id) })); setSelectedNodeId(undefined); setShowNodeFile(false); }}><span aria-hidden="true">⌫</span> Delete node</button>}
    {selectedNode!==undefined&&<aside className="node-settings"><h3>Node settings</h3><label>Name<input aria-label="Node name" value={selectedNode.name} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,name:e.target.value}:node)}))}/></label>{webhookUrl !== undefined && <div className="webhook-controls"><label>Webhook URL</label><input aria-label="Webhook URL" readOnly value={webhookUrl}/><button type="button" onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => { setCopiedWebhook(true); window.setTimeout(() => setCopiedWebhook(false), 2_000); })}>{copiedWebhook ? "Copied" : "Copy URL"}</button><small>Send the required signed request from your external service.</small></div>}{selectedNode.name === "HTTP Request" && <><label>Method<select value={typeof selectedNode.parameters.method === "string" ? selectedNode.parameters.method : "GET"} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,method:e.target.value}}:node)}))}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><label>URL<input type="url" value={typeof selectedNode.parameters.url === "string" ? selectedNode.parameters.url : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,url:e.target.value}}:node)}))}/></label><label>Response<select value={typeof selectedNode.parameters.responseFormat === "string" ? selectedNode.parameters.responseFormat : "json"} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,responseFormat:e.target.value}}:node)}))}><option value="json">JSON</option><option value="file">File</option></select></label></>}{selectedNode.name === "Code" && <label>Code<textarea value={typeof selectedNode.parameters.code === "string" ? selectedNode.parameters.code : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,code:e.target.value}}:node)}))}/></label>}{selectedNode.name === "Postgres" && <label>Query<textarea value={typeof selectedNode.parameters.query === "string" ? selectedNode.parameters.query : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,query:e.target.value}}:node)}))}/></label>}{selectedNode.name === "Google Sheets" && <><label>Spreadsheet ID<input value={typeof selectedNode.parameters.spreadsheetId === "string" ? selectedNode.parameters.spreadsheetId : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,spreadsheetId:e.target.value}}:node)}))}/></label><label>Range<input value={typeof selectedNode.parameters.range === "string" ? selectedNode.parameters.range : "Sheet1!A:Z"} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,range:e.target.value}}:node)}))}/></label></>}{selectedNode.name === "Gmail" && <><label>To<input type="email" value={typeof selectedNode.parameters.to === "string" ? selectedNode.parameters.to : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,to:e.target.value}}:node)}))}/></label><label>Subject<input value={typeof selectedNode.parameters.subject === "string" ? selectedNode.parameters.subject : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,subject:e.target.value}}:node)}))}/></label><label>Body<textarea value={typeof selectedNode.parameters.body === "string" ? selectedNode.parameters.body : ""} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters:{...node.parameters,body:e.target.value}}:node)}))}/></label></>}<label>Credential<select value={Object.values(selectedNode.credentials)[0]??""} onChange={e=>{const selected=credentialOptions.find(option=>option.id===e.target.value);setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,credentials:selected===undefined?{}:{[selected.type]:selected.id}}:node)}));}}><option value="">No credential</option>{credentialOptions.map(option=><option key={option.id} value={option.id}>{option.name} ({option.type})</option>)}</select></label><details><summary>Advanced JSON parameters</summary><textarea aria-label="Node parameters" value={JSON.stringify(selectedNode.parameters,null,2)} onChange={e=>{try{const parameters=JSON.parse(e.target.value);setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,parameters}:node)}));}catch{/* retain invalid draft until corrected */}}}/></details><label>Error behavior<select aria-label="Error behavior" value={selectedNode.onError??"stop"} onChange={e=>setWorkflow(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedNode.id?{...node,onError:e.target.value as "stop"|"continue"}:node)}))}><option value="stop">Stop on error</option><option value="continue">Continue on error</option></select></label></aside>}
  </section>;
}
