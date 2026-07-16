import { Pool, type PoolConfig } from "pg";
import type { IWorkflow, WorkflowId } from "@spiderz/shared";

export interface StoredWorkflow extends IWorkflow { readonly enabled: boolean; }

export class WorkflowRepository {
  private readonly pool: Pool;
  public constructor(config: PoolConfig) { this.pool = new Pool(config); }
  public async getEnabledById(id: WorkflowId): Promise<StoredWorkflow | undefined> {
    const result = await this.pool.query<{ definition: IWorkflow | string; enabled: boolean }>("SELECT definition, enabled FROM workflows WHERE id = $1 AND enabled = true LIMIT 1", [id]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const definition = typeof row.definition === "string" ? JSON.parse(row.definition) as IWorkflow : row.definition;
    return { ...definition, enabled: row.enabled };
  }
  public async close(): Promise<void> { await this.pool.end(); }
}
