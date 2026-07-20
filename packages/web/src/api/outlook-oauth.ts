import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export async function outlookAuthorizationUrl(): Promise<string> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/oauth/outlook/authorize-url`, { method: "POST", headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Outlook OAuth is not configured. Add MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, and MICROSOFT_OAUTH_REDIRECT_URI to .env first.");
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Microsoft authorization URL was missing.");
  return payload.url;
}
