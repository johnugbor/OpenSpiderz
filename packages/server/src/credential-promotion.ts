import { Pool, type PoolConfig } from "pg";
import type { IWorkflow } from "@spiderz/shared";
/** Rewrites only credential references while preserving an immutable production graph. */
export class CredentialPromotionService {
  private readonly pool: Pool;
  public constructor(config: PoolConfig) { this.pool = new Pool(config); }
  public async promote(workflow: IWorkflow): Promise<IWorkflow> {
    const ids = [...new Set(workflow.nodes.flatMap((node) => Object.values(node.credentials)))];
    if (ids.length === 0) return workflow;
    const result = await this.pool.query<{ development_credential_id: string; production_credential_id: string }>("SELECT development_credential_id,production_credential_id FROM credential_promotions WHERE development_credential_id = ANY($1::uuid[])", [ids]);
    const mapping = new Map(result.rows.map((row) => [row.development_credential_id, row.production_credential_id]));
    if (mapping.size !== ids.length) throw new Error("Every development credential requires an approved production mapping before deployment.");
    return { ...workflow, nodes: workflow.nodes.map((node) => ({ ...node, credentials: Object.fromEntries(Object.entries(node.credentials).map(([type, id]) => [type, mapping.get(id)!])) })) };
  }
}
