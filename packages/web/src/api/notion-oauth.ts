import { authorizedHeaders } from "./auth.js";
import { currentWorkspaceId } from "./workspace.js";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
export async function notionAuthorizationUrl(): Promise<string> {
  const response = await fetch(`${API}/api/workspaces/${currentWorkspaceId()}/oauth/notion/authorize-url`, { method: "POST", headers: authorizedHeaders() });
  if (!response.ok) throw new Error("Notion OAuth is not configured. Add NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI to .env first.");
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Notion authorization URL was missing.");
  return payload.url;
}
