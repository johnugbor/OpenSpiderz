import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto } from "./credential-crypto.js";
import { requireWorkspaceRole } from "./rbac.js";

interface OutlookOAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; }
interface OAuthState { readonly workspaceId: string; readonly userId: string; readonly nonce: string; }
interface TokenResponse { readonly access_token?: unknown; readonly refresh_token?: unknown; readonly expires_in?: unknown; readonly error?: unknown; readonly error_description?: unknown; }

const AUTHORIZATION_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES = "https://graph.microsoft.com/Mail.Send offline_access";

/** Connects a Microsoft account to one workspace; tokens remain encrypted in oauth2_credentials. */
export function registerOutlookOAuthRoutes(app: FastifyInstance, database: PoolConfig, crypto: CredentialCrypto, config: OutlookOAuthConfig | undefined): void {
  const pool = new Pool(database);
  const authorizationUrl = (workspaceId: string, userId: string): string => {
    if (config === undefined) throw Object.assign(new Error("Outlook OAuth is not configured."), { statusCode: 503 });
    const state = app.jwt.sign({ workspaceId, userId, nonce: globalThis.crypto.randomUUID() } as never, { expiresIn: "10m" });
    const query = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, response_mode: "query", scope: SCOPES, state });
    return `${AUTHORIZATION_ENDPOINT}?${query}`;
  };

  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/outlook/authorize-url", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request) => ({ url: authorizationUrl(request.params.workspaceId, request.user.sub) }));
  app.get<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/outlook/authorize", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request, reply) => reply.redirect(authorizationUrl(request.params.workspaceId, request.user.sub)));
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/api/oauth/outlook/callback", async (request, reply) => {
    if (config === undefined) return reply.code(503).send({ error: "Outlook OAuth is not configured." });
    if (request.query.error !== undefined) return reply.code(400).send({ error: `Microsoft authorization failed: ${request.query.error}${request.query.error_description === undefined ? "" : ` (${request.query.error_description})`}` });
    if (request.query.code === undefined || request.query.state === undefined) return reply.code(400).send({ error: "Missing Microsoft authorization response." });
    let state: OAuthState;
    try { state = app.jwt.verify(request.query.state) as unknown as OAuthState; } catch { return reply.code(400).send({ error: "Invalid or expired OAuth state." }); }

    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code: request.query.code, redirect_uri: config.redirectUri, grant_type: "authorization_code", scope: SCOPES });
    const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => undefined) as TokenResponse | undefined;
    if (!response.ok || typeof token?.access_token !== "string" || typeof token.refresh_token !== "string" || typeof token.expires_in !== "number") {
      const detail = typeof token?.error_description === "string" ? token.error_description : typeof token?.error === "string" ? token.error : "Microsoft did not return a reusable OAuth credential.";
      return reply.code(502).send({ error: `Microsoft token exchange failed: ${detail}` });
    }
    const encrypted = crypto.encrypt(JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken: token.access_token, refreshToken: token.refresh_token }));
    await pool.query("INSERT INTO oauth2_credentials(owner_id,workspace_id,provider,token_url,secret_ciphertext,secret_iv,secret_auth_tag,key_version,expires_at) VALUES($1,$2,'outlook',$3,$4,$5,$6,$7,$8)", [state.userId, state.workspaceId, TOKEN_ENDPOINT, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, new Date(Date.now() + token.expires_in * 1_000)]);
    return reply.type("text/html").send("<script>window.close()</script><p>Microsoft account connected. You may close this window.</p>");
  });
}
