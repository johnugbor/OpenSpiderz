import { createHash, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto } from "./credential-crypto.js";
import { requireWorkspaceRole } from "./rbac.js";

interface AirtableOAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; }
interface OAuthState { readonly workspaceId: string; readonly userId: string; readonly nonce: string; }
const scopes = "data.records:write data.records:read schema.bases:read";

export function registerAirtableOAuthRoutes(app: FastifyInstance, database: PoolConfig, crypto: CredentialCrypto, config: AirtableOAuthConfig | undefined): void {
  const pool = new Pool(database);
  const verifier = (nonce: string): string => createHmac("sha256", config!.clientSecret).update(nonce).digest("base64url");
  const authorizationUrl = (workspaceId: string, userId: string): string => {
    if (config === undefined) throw Object.assign(new Error("Airtable OAuth is not configured."), { statusCode: 503 });
    const nonce = globalThis.crypto.randomUUID();
    const state = app.jwt.sign({ workspaceId, userId, nonce } as never, { expiresIn: "10m" });
    const challenge = createHash("sha256").update(verifier(nonce)).digest("base64url");
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: scopes, code_challenge: challenge, code_challenge_method: "S256", state });
    return `https://airtable.com/oauth2/v1/authorize?${query}`;
  };
  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/oauth/airtable/authorize-url", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request) => ({ url: authorizationUrl(request.params.workspaceId, request.user.sub) }));
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/oauth/airtable/callback", async (request, reply) => {
    if (config === undefined) return reply.code(503).send({ error: "Airtable OAuth is not configured." });
    if (request.query.error !== undefined) return reply.code(400).send({ error: `Airtable authorization failed: ${request.query.error}` });
    if (request.query.code === undefined || request.query.state === undefined) return reply.code(400).send({ error: "Missing Airtable authorization response." });
    let state: OAuthState;
    try { state = app.jwt.verify(request.query.state) as unknown as OAuthState; } catch { return reply.code(400).send({ error: "Invalid or expired OAuth state." }); }
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
    const body = new URLSearchParams({ grant_type: "authorization_code", code: request.query.code, redirect_uri: config.redirectUri, code_verifier: verifier(state.nonce) });
    const response = await fetch("https://airtable.com/oauth2/v1/token", { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => undefined) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown } | undefined;
    if (!response.ok || typeof token?.access_token !== "string" || typeof token.refresh_token !== "string") return reply.code(502).send({ error: `Airtable token exchange failed: ${typeof token?.error === "string" ? token.error : "unknown error"}` });
    const encrypted = crypto.encrypt(JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken: token.access_token, refreshToken: token.refresh_token }));
    await pool.query("INSERT INTO oauth2_credentials(owner_id,workspace_id,provider,token_url,secret_ciphertext,secret_iv,secret_auth_tag,key_version,expires_at) VALUES($1,$2,'airtable','https://airtable.com/oauth2/v1/token',$3,$4,$5,$6,$7)", [state.userId, state.workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, new Date(Date.now() + (typeof token.expires_in === "number" ? token.expires_in : 3_600) * 1_000)]);
    return reply.type("text/html").send("<script>window.close()</script><p>Airtable account connected. You may close this window.</p>");
  });
}
