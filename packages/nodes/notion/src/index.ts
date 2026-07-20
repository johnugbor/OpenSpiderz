import type { JsonObject, JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** Creates one Notion child page per incoming item under a shared parent page. */
export class NotionCreatePageExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly token: string | undefined) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const credentialId = Object.values(context.node.credentials)[0];
    const accessToken = typeof credentialId === "string" && context.getCredentialAccessToken !== undefined ? await context.getCredentialAccessToken(credentialId) : this.token;
    if (accessToken === undefined) throw new Error("Notion requires a Notion OAuth2 credential or NOTION_API_TOKEN on the server.");
    const parentPageId = context.node.parameters.parentPageId, titleField = context.node.parameters.titleField, bodyField = context.node.parameters.bodyField;
    if (typeof parentPageId !== "string" || parentPageId.trim() === "") throw new Error("Notion requires a parent page ID.");
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const record = unwrapFormBody(item);
      const title = stringAtPath(record, typeof titleField === "string" ? titleField : "name") || "Workflow item";
      const configuredBody = stringAtPath(record, typeof bodyField === "string" ? bodyField : "reply");
      const body = configuredBody === "" ? JSON.stringify(record, null, 2) : configuredBody;
      const response = await fetch("https://api.notion.com/v1/pages", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "notion-version": "2026-03-11", "content-type": "application/json" }, body: JSON.stringify({ parent: { page_id: parentPageId }, properties: { title: { title: [{ text: { content: title.slice(0, 2_000) } }] } }, ...(body === "" ? {} : { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: body.slice(0, 2_000) } }] } }] }) }), signal: context.signal });
      const payload = await response.json().catch(() => undefined) as JsonValue;
      if (!response.ok) throw new Error(`Notion page creation failed (${response.status}): ${notionError(payload)}.`);
      output.push(payload);
    }
    return output;
  }
}
function notionError(value: JsonValue): string { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.message === "string" ? value.message : "Notion did not return an error message"; }
function unwrapFormBody(value: JsonValue): JsonObject { if (typeof value === "object" && value !== null && !Array.isArray(value)) { const body = value.body; return typeof body === "object" && body !== null && !Array.isArray(body) ? body : value; } return { value }; }
function stringAtPath(value: JsonValue, path: string): string { const result = path.split(".").reduce<JsonValue | undefined>((current, segment) => typeof current === "object" && current !== null && !Array.isArray(current) ? current[segment] : undefined, value); return result === undefined || result === null ? "" : typeof result === "object" ? JSON.stringify(result) : String(result); }
