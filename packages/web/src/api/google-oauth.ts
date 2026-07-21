import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export async function googleAuthorizationUrl(): Promise<string> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/oauth/google/authorize-url`, {
    method: "POST",
    headers: authorizedHeaders(),
  });
  if (!response.ok) throw new Error("Could not start Google authorization.");
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Google authorization URL was missing.");
  return payload.url;
}
