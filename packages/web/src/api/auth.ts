const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const KEY = "spiderz.access-token";
export function accessToken(): string | undefined { return sessionStorage.getItem(KEY) ?? undefined; }
export function signOut(): void { sessionStorage.removeItem(KEY); sessionStorage.removeItem("spiderz.workspace-id"); }
export async function authenticate(mode: "login" | "register", email: string, password: string): Promise<void> {
  const response = await fetch(`${API}/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!response.ok) { const payload: unknown = await response.json().catch(() => undefined); throw new Error(typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Authentication failed."); }
  const payload = await response.json() as { accessToken?: unknown };
  if (typeof payload.accessToken !== "string") throw new Error("Server did not return an access token.");
  sessionStorage.setItem(KEY, payload.accessToken);
}
export function authorizedHeaders(): HeadersInit { const token = accessToken(); return token === undefined ? { "content-type": "application/json" } : { "content-type": "application/json", authorization: `Bearer ${token}` }; }
