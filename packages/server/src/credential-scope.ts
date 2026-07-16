import { Pool, type PoolConfig } from "pg";
/** Enforces that a credential belongs to the workflow's workspace/environment. */
export class CredentialScope {
  private readonly pool: Pool;
  public constructor(config: PoolConfig) { this.pool = new Pool(config); }
  public async assertOAuthCredential(workspaceId: string, credentialId: string): Promise<void> {
    const result = await this.pool.query("SELECT 1 FROM oauth2_credentials WHERE id=$1 AND workspace_id=$2", [credentialId, workspaceId]);
    if (result.rowCount !== 1) throw new Error("Credential is not available in this workspace environment.");
  }
}
