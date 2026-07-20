import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto } from "./credential-crypto.js";
import { requireWorkspaceRole } from "./rbac.js";

interface NotionOAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; }
interface OAuthState { readonly workspaceId: string; readonly userId: string; readonly nonce: string; }

export function registerNotionOAuthRoutes(app: FastifyInstance, database: PoolConfig, crypto: CredentialCrypto, config: NotionOAuthConfig | undefined): void {
  const pool = new Pool(database);
  const authorizationUrl = (workspaceId: string, userId: string): string => {
    if (config === undefined) throw Object.assign(new Error("Notion OAuth is not configured."), { statusCode: 503 });
    const state = app.jwt.sign({ workspaceId, userId, nonce: globalThis.crypto.randomUUID() } as never, { expiresIn: "10m" });
    const query = new URLSearchParams({ owner: "user", client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", state });
    return `https://api.notion.com/v1/oauth/authorize?${query}`;
  };
  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/notion/authorize-url", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request) => ({ url: authorizationUrl(request.params.workspaceId, request.user.sub) }));
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/oauth/notion/callback", async (request, reply) => {
    if (config === undefined) return reply.code(503).send({ error: "Notion OAuth is not configured." });
    if (request.query.error !== undefined) return reply.code(400).send({ error: `Notion authorization failed: ${request.query.error}` });
    if (request.query.code === undefined || request.query.state === undefined) return reply.code(400).send({ error: "Missing Notion authorization response." });
    let state: OAuthState;
    try { state = app.jwt.verify(request.query.state) as unknown as OAuthState; } catch { return reply.code(400).send({ error: "Invalid or expired OAuth state." }); }
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
    const response = await fetch("https://api.notion.com/v1/oauth/token", { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code: request.query.code, redirect_uri: config.redirectUri }), signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => undefined) as { access_token?: unknown; refresh_token?: unknown; error?: unknown } | undefined;
    if (!response.ok || typeof token?.access_token !== "string") return reply.code(502).send({ error: `Notion token exchange failed: ${typeof token?.error === "string" ? token.error : "unknown error"}` });
    const encrypted = crypto.encrypt(JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken: token.access_token, refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : "not-applicable" }));
    await pool.query("INSERT INTO oauth2_credentials(owner_id,workspace_id,provider,token_url,secret_ciphertext,secret_iv,secret_auth_tag,key_version,expires_at) VALUES($1,$2,'notion','https://api.notion.com/v1/oauth/token',$3,$4,$5,$6,$7)", [state.userId, state.workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, new Date("2035-01-01T00:00:00.000Z")]);
    return reply.type("text/html").send("<script>window.close()</script><p>Notion workspace connected. You may close this window.</p>");
  });
}
