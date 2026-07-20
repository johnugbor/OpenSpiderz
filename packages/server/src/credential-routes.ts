import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";
import { requireWorkspaceRole } from "./rbac.js";

/** Lists reference metadata only. Encrypted credential material never leaves the server. */
export function registerCredentialRoutes(app: FastifyInstance, config: PoolConfig): void {
  const pool = new Pool(config);
  app.get<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/credentials", { preHandler: requireWorkspaceRole(config, "owner", "admin", "member", "read_only") }, async (request) => {
    const [standard, oauth] = await Promise.all([
      pool.query<{ id: string; name: string; credential_type: string }>("SELECT id,name,credential_type FROM credentials WHERE workspace_id=$1 ORDER BY name", [request.params.workspaceId]),
      pool.query<{ id: string; provider: string }>("SELECT id,provider FROM oauth2_credentials WHERE workspace_id=$1 ORDER BY provider", [request.params.workspaceId]),
    ]);
    return [...standard.rows.map((credential) => ({ id: credential.id, name: credential.name, type: credential.credential_type })), ...oauth.rows.map((credential) => ({ id: credential.id, name: `${credential.provider} OAuth2`, type: "oauth2" }))];
  });
}
