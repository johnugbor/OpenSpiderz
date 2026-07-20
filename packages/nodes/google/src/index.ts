import type { JsonObject, JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

function credentialId(context: INodeExecutionContext): string { const id = Object.values(context.node.credentials)[0]; if (typeof id !== "string" || context.getCredentialAccessToken === undefined) throw new Error("Google node requires an OAuth2 credential."); return id; }
async function token(context: INodeExecutionContext): Promise<string> { return context.getCredentialAccessToken!(credentialId(context)); }

export class GoogleSheetsAppendRowExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const spreadsheetId = context.node.parameters.spreadsheetId, range = context.node.parameters.range;
    if (typeof spreadsheetId !== "string" || typeof range !== "string") throw new Error("Google Sheets requires spreadsheetId and range.");
    const records = context.input.map(normalizeRecord);
    const rows = records.map((record) => Object.values(record).map(cellValue));
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=true`, { method: "POST", headers: { authorization: `Bearer ${await token(context)}`, "content-type": "application/json" }, body: JSON.stringify({ majorDimension: "ROWS", values: rows }), signal: context.signal });
    if (!response.ok) throw new Error(`Google Sheets append failed (${response.status}): ${await googleError(response)}`);
    const result = await response.json() as { updates?: { updatedRange?: unknown; updatedData?: { values?: unknown } } };
    const returnedRows = Array.isArray(result.updates?.updatedData?.values) ? result.updates.updatedData.values : rows;
    return records.map((record, index) => ({ ...record, sheet: { range: typeof result.updates?.updatedRange === "string" ? result.updates.updatedRange : range, values: toJsonRow(returnedRows[index] ?? rows[index] ?? []) } }));
  }
}

export class GmailSendExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const configuredRecipient = context.node.parameters.to, subject = context.node.parameters.subject, configuredBody = context.node.parameters.body;
    const recipientField = context.node.parameters.recipientField, bodyField = context.node.parameters.bodyField;
    if (typeof subject !== "string") throw new Error("Gmail requires a subject.");
    if (configuredRecipient !== undefined && typeof configuredRecipient !== "string") throw new Error("Gmail recipient must be text.");
    if (configuredBody !== undefined && typeof configuredBody !== "string") throw new Error("Gmail body must be text.");
    const accessToken = await token(context);
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const record = normalizeRecord(item);
      const to = configuredRecipient?.trim() || stringAtPath(record, typeof recipientField === "string" ? recipientField : "email");
      const body = configuredBody?.trim() || stringAtPath(record, typeof bodyField === "string" ? bodyField : "reply");
      if (to === "") throw new Error("Gmail could not find a recipient in the incoming item.");
      const mime = `To: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
      const raw = Buffer.from(mime, "utf8").toString("base64url");
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ raw }), signal: context.signal });
      if (!response.ok) throw new Error(`Gmail send failed (${response.status}): ${await googleError(response)}`);
      output.push(await response.json() as JsonValue);
    }
    return output;
  }
}

function normalizeRecord(value: JsonValue): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const body = value.body;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body : value;
  }
  return { value };
}

async function googleError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { error?: { message?: unknown } } | undefined;
  return typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 500) : "Google did not return an error message.";
}

function cellValue(value: JsonValue): string | number | boolean { return value === null ? "" : typeof value === "object" ? JSON.stringify(value) : value; }
function toJsonRow(value: unknown): JsonValue[] { return Array.isArray(value) ? value.map((cell) => typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" || cell === null ? cell : String(cell)) : []; }
function stringAtPath(record: JsonObject, path: string): string { const value = path.split(".").reduce<JsonValue | undefined>((current, segment) => typeof current === "object" && current !== null && !Array.isArray(current) ? current[segment] : undefined, record); return value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); }
