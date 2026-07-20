import type { JsonValue } from "@spiderz/shared";
import { WorkflowNodeExecutor, type INodeExecutionContext } from "@spiderz/core";

export class TelegramSendMessageExecutor extends WorkflowNodeExecutor {
  public constructor(private readonly botToken: string | undefined) { super(); }
  public async execute(context: INodeExecutionContext): Promise<readonly JsonValue[]> {
    if (this.botToken === undefined) throw new Error("Telegram is not configured. Set TELEGRAM_BOT_TOKEN on the server.");
    const chatId = context.node.parameters.chatId, configuredText = context.node.parameters.text, textField = context.node.parameters.textField;
    if (typeof chatId !== "string" || chatId.trim() === "") throw new Error("Telegram requires a chat ID or @channel username.");
    if (configuredText !== undefined && typeof configuredText !== "string") throw new Error("Telegram message text must be text.");
    const output: JsonValue[] = [];
    for (const item of context.input) {
      const text = configuredText?.trim() || stringAtPath(item, typeof textField === "string" ? textField : "reply");
      if (text === "") throw new Error("Telegram could not find message text in the incoming item.");
      if (text.length > 4096) throw new Error("Telegram messages cannot exceed 4096 characters.");
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }), signal: context.signal });
      const payload = await response.json().catch(() => undefined) as JsonValue;
      if (!response.ok || !isSuccess(payload)) throw new Error(`Telegram message failed: ${errorMessage(payload, response.status)}.`);
      output.push(payload);
    }
    return output;
  }
}

function isSuccess(value: JsonValue): boolean { return typeof value === "object" && value !== null && !Array.isArray(value) && value.ok === true; }
function errorMessage(value: JsonValue, status: number): string { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.description === "string" ? value.description : `HTTP ${status}`; }
function stringAtPath(value: JsonValue, path: string): string { const result = path.split(".").reduce<JsonValue | undefined>((current, segment) => typeof current === "object" && current !== null && !Array.isArray(current) ? current[segment] : undefined, value); return result === undefined || result === null ? "" : typeof result === "object" ? JSON.stringify(result) : String(result); }
