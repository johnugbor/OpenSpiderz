import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

/** Sends one Slack chat message for every workflow input item. Requires a Slack OAuth2 credential. */
export class SlackSendMessageExecutor extends WorkflowNodeExecutor {
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    const channel = context.node.parameters.channel;
    const configuredText = context.node.parameters.text;
    const textField = context.node.parameters.textField;
    const credentialId = Object.values(context.node.credentials)[0];
    if (typeof channel !== "string" || channel.trim() === "") throw new Error("Slack requires a channel ID or channel name.");
    if (typeof credentialId !== "string" || context.getCredentialAccessToken === undefined) throw new Error("Slack requires an OAuth2 credential.");
    if (configuredText !== undefined && typeof configuredText !== "string") throw new Error("Slack message text must be text.");
    const accessToken = await context.getCredentialAccessToken(credentialId);
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const text = configuredText?.trim() || stringAtPath(item, typeof textField === "string" ? textField : "reply");
      if (text === "") throw new Error("Slack could not find message text in the incoming item.");
      const response = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text }), signal: context.signal });
      const payload = await response.json().catch(() => undefined) as JsonValue;
      if (!response.ok || !isSlackSuccess(payload)) throw new Error(`Slack message failed: ${slackError(payload, response.status)}.`);
      output.push(payload);
    }
    return output;
  }
}

function isSlackSuccess(value: JsonValue): boolean { return typeof value === "object" && value !== null && !Array.isArray(value) && value.ok === true; }
function slackError(value: JsonValue, status: number): string { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.error === "string" ? value.error : `HTTP ${status}`; }
function stringAtPath(value: JsonValue, path: string): string { const result = path.split(".").reduce<JsonValue | undefined>((current, segment) => typeof current === "object" && current !== null && !Array.isArray(current) ? current[segment] : undefined, value); return result === undefined || result === null ? "" : typeof result === "object" ? JSON.stringify(result) : String(result); }
