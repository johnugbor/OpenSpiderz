import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
export interface CredentialReference { readonly id: string; readonly name: string; readonly type: string; }
export async function credentials(): Promise<CredentialReference[]> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/credentials`, { headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Could not load credential references.");
  return response.json() as Promise<CredentialReference[]>;
}
