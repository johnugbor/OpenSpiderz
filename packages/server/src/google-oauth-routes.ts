import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto } from "./credential-crypto.js";
import { requireWorkspaceRole } from "./rbac.js";

interface GoogleOAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; }
interface OAuthState { readonly workspaceId: string; readonly userId: string; readonly nonce: string; }

export function registerGoogleOAuthRoutes(app: FastifyInstance, database: PoolConfig, crypto: CredentialCrypto, config: GoogleOAuthConfig): void {
  const pool = new Pool(database);
  const authorizationUrl = (workspaceId: string, userId: string): string => {
    const state = app.jwt.sign({ workspaceId, userId, nonce: globalThis.crypto.randomUUID() } as never, { expiresIn: "10m" });
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", access_type: "offline", prompt: "select_account consent", scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  };
  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/google/authorize-url", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request) => ({ url: authorizationUrl(request.params.workspaceId, request.user.sub) }));
  app.get<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/google/authorize", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request, reply) => {
    return reply.redirect(authorizationUrl(request.params.workspaceId, request.user.sub));
  });
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/oauth/google/callback", async (request, reply) => {
    if (request.query.error !== undefined) return reply.code(400).send({ error: `Google authorization failed: ${request.query.error}` });
    if (request.query.code === undefined || request.query.state === undefined) return reply.code(400).send({ error: "Missing Google authorization response." });
    let state: OAuthState;
    try { state = app.jwt.verify(request.query.state) as unknown as OAuthState; } catch { return reply.code(400).send({ error: "Invalid or expired OAuth state." }); }
    const body = new URLSearchParams({ code: request.query.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    if (!tokenResponse.ok) return reply.code(502).send({ error: "Google token exchange failed." });
    const token = await tokenResponse.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string" || typeof token.expires_in !== "number") return reply.code(502).send({ error: "Google did not return a reusable OAuth credential." });
    const encrypted = crypto.encrypt(JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken: token.access_token, refreshToken: token.refresh_token }));
    await pool.query("INSERT INTO oauth2_credentials(owner_id,workspace_id,provider,token_url,secret_ciphertext,secret_iv,secret_auth_tag,key_version,expires_at) VALUES($1,$2,'google','https://oauth2.googleapis.com/token',$3,$4,$5,$6,$7)", [state.userId, state.workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, new Date(Date.now() + token.expires_in * 1_000)]);
    return reply.type("text/html").send("<script>window.close()</script><p>Google account connected. You may close this window.</p>");
  });
}
