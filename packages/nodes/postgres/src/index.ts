import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

export interface SqlQueryClient { query(text: string, values?: readonly unknown[]): Promise<{ rows: JsonValue[] }>; }
/** Executes configured parameterized SQL through a server-owned database client. */
export class PostgresNodeExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly database: SqlQueryClient) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const query = context.node.parameters.query;
    if (typeof query !== "string" || query.trim() === "") throw new Error("Postgres node requires a query.");
    const values = Array.isArray(context.node.parameters.values) ? context.node.parameters.values : [];
    return (await this.database.query(query, values)).rows;
  }
}
