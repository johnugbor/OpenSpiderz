import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

export class OutlookSendMailExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly accessToken: string | undefined) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    if (this.accessToken === undefined) throw new Error("Outlook is not configured. Set MICROSOFT_GRAPH_ACCESS_TOKEN on the server.");
    const configuredTo = context.node.parameters.to, subject = context.node.parameters.subject, configuredBody = context.node.parameters.body, recipientField = context.node.parameters.recipientField, bodyField = context.node.parameters.bodyField;
    if (typeof subject !== "string") throw new Error("Outlook requires a subject.");
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const to = typeof configuredTo === "string" && configuredTo.trim() !== "" ? configuredTo : stringAtPath(item, typeof recipientField === "string" ? recipientField : "email");
      const body = typeof configuredBody === "string" && configuredBody.trim() !== "" ? configuredBody : stringAtPath(item, typeof bodyField === "string" ? bodyField : "reply");
      if (to === "") throw new Error("Outlook could not find a recipient in the incoming item.");
      const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", { method: "POST", headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: body }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }), signal: context.signal });
      if (!response.ok) throw new Error(`Outlook send mail failed (${response.status}): ${await graphError(response)}.`);
      output.push({ to, subject, accepted: true });
    }
    return output;
  }
}
async function graphError(response: Response): Promise<string> { const value = await response.json().catch(() => undefined) as { error?: { message?: unknown } } | undefined; return typeof value?.error?.message === "string" ? value.error.message : "Microsoft Graph did not return an error message"; }
function stringAtPath(value: JsonValue, path: string): string { const result = path.split(".").reduce<JsonValue | undefined>((current, segment) => typeof current === "object" && current !== null && !Array.isArray(current) ? current[segment] : undefined, value); return result === undefined || result === null ? "" : typeof result === "object" ? JSON.stringify(result) : String(result); }
