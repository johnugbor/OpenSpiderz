import type { JsonObject, JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

export class AirtableCreateRecordExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly token: string | undefined) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    if (this.token === undefined) throw new Error("Airtable is not configured. Set AIRTABLE_PERSONAL_ACCESS_TOKEN on the server.");
    const baseId = context.node.parameters.baseId, table = context.node.parameters.table;
    if (typeof baseId !== "string" || baseId.trim() === "" || typeof table !== "string" || table.trim() === "") throw new Error("Airtable requires a base ID and table name or ID.");
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const fields = recordFields(item);
      const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`, { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify({ fields }), signal: context.signal });
      const payload = await response.json().catch(() => undefined) as JsonValue;
      if (!response.ok) throw new Error(`Airtable record creation failed (${response.status}): ${airtableError(payload)}.`);
      output.push(payload);
    }
    return output;
  }
}
function recordFields(value: JsonValue): JsonObject { if (typeof value === "object" && value !== null && !Array.isArray(value)) { const body = value.body; return typeof body === "object" && body !== null && !Array.isArray(body) ? body : value; } return { value }; }
function airtableError(value: JsonValue): string { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.error === "object" && value.error !== null && !Array.isArray(value.error) && typeof value.error.message === "string" ? value.error.message : "Airtable did not return an error message"; }
