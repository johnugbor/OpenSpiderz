import type { IWorkflow } from "@spiderz/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** Persists the same graph object used by the canvas; credentials are references only. */
export async function saveWorkflow(workflow: IWorkflow, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/workflows/save`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(workflow),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`Workflow save failed (${response.status}).`);
}
