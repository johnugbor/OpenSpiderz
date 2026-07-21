import type { IWorkflow } from "@spiderz/shared";
import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

/** Persists the same graph object used by the canvas; credentials are references only. */
export async function saveWorkflow(workflow: IWorkflow, signal?: AbortSignal, autosave = false, versionMessage?: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${currentWorkspaceId()}/workflows/${workflow.id}?autosave=${autosave}`, {
    method: "PUT",
    headers: { ...authorizedHeaders(), accept: "application/json", ...(versionMessage === undefined || versionMessage.trim() === "" ? {} : { "x-spiderz-version-message": versionMessage.trim().slice(0, 500) }) },
    credentials: "include",
    body: JSON.stringify(workflow),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`Workflow save failed (${response.status}).`);
}
