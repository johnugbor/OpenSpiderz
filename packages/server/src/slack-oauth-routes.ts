import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto } from "./credential-crypto.js";
import { requireWorkspaceRole } from "./rbac.js";

interface SlackOAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; }
interface OAuthState { readonly workspaceId: string; readonly userId: string; readonly nonce: string; }

export function registerSlackOAuthRoutes(app: FastifyInstance, database: PoolConfig, crypto: CredentialCrypto, config: SlackOAuthConfig | undefined): void {
  const pool = new Pool(database);
  const authorizationUrl = (workspaceId: string, userId: string): string => {
    if (config === undefined) throw Object.assign(new Error("Slack OAuth is not configured."), { statusCode: 503 });
    const state = app.jwt.sign({ workspaceId, userId, nonce: globalThis.crypto.randomUUID() } as never, { expiresIn: "10m" });
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: "chat:write", state });
    return `https://slack.com/oauth/v2/authorize?${query}`;
  };
  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/slack/authorize-url", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request) => ({ url: authorizationUrl(request.params.workspaceId, request.user.sub) }));
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/oauth/slack/callback", async (request, reply) => {
    if (config === undefined) return reply.code(503).send({ error: "Slack OAuth is not configured." });
    if (request.query.error !== undefined) return reply.code(400).send({ error: `Slack authorization failed: ${request.query.error}` });
    if (request.query.code === undefined || request.query.state === undefined) return reply.code(400).send({ error: "Missing Slack authorization response." });
    let state: OAuthState;
    try { state = app.jwt.verify(request.query.state) as unknown as OAuthState; } catch { return reply.code(400).send({ error: "Invalid or expired OAuth state." }); }
    const body = new URLSearchParams({ code: request.query.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri });
    const response = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => undefined) as { ok?: unknown; access_token?: unknown; error?: unknown } | undefined;
    if (!response.ok || token?.ok !== true || typeof token.access_token !== "string") return reply.code(502).send({ error: `Slack token exchange failed: ${typeof token?.error === "string" ? token.error : "unknown error"}` });
    const encrypted = crypto.encrypt(JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken: token.access_token, refreshToken: "not-applicable" }));
    await pool.query("INSERT INTO oauth2_credentials(owner_id,workspace_id,provider,token_url,secret_ciphertext,secret_iv,secret_auth_tag,key_version,expires_at) VALUES($1,$2,'slack','https://slack.com/api/oauth.v2.access',$3,$4,$5,$6,$7)", [state.userId, state.workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, new Date("2035-01-01T00:00:00.000Z")]);
    return reply.type("text/html").send("<script>window.close()</script><p>Slack workspace connected. You may close this window.</p>");
  });
}
