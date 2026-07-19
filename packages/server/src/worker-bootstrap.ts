import { BinaryDataManager, createWorkflowWorker, PostgresWorkflowRepository, type NodeExecutorResolver } from "@spiderz/core";
import { AirtableCreateRecordExecutor, CodeNodeExecutor, FileInputNodeExecutor, FormTriggerNodeExecutor, GmailSendExecutor, GoogleDriveCreateTextFileExecutor, GoogleSheetsAppendRowExecutor, HttpRequestNodeExecutor, NotionCreatePageExecutor, OutlookSendMailExecutor, PostgresNodeExecutor, SlackSendMessageExecutor, TelegramSendMessageExecutor, WebhookNodeExecutor } from "@spiderz/nodes";
import { loadEnvironment } from "./environment.js";
import { CredentialCrypto } from "./credential-crypto.js";
import { CredentialManager } from "./credential-manager.js";
import { ExecutionLogRepository } from "./execution-log-repository.js";
import { Redis } from "ioredis";
import { Pool } from "pg";
import { createBinaryStorage } from "./binary-storage-factory.js";

const codeNodeExecutor = new CodeNodeExecutor();
const fileInputNodeExecutor = new FileInputNodeExecutor();
const env = loadEnvironment();
const workerDatabase = new Pool({ connectionString: env.databaseUrl });
const webhookNodeExecutor = new WebhookNodeExecutor();
const formTriggerNodeExecutor = new FormTriggerNodeExecutor();
const httpRequestNodeExecutor = new HttpRequestNodeExecutor(new BinaryDataManager(createBinaryStorage(env)));
const postgresNodeExecutor = new PostgresNodeExecutor({ query: async (text, values) => { const result = await workerDatabase.query(text, values as unknown[]); return { rows: result.rows }; } });
const googleSheetsAppendRowExecutor = new GoogleSheetsAppendRowExecutor();
const gmailSendExecutor = new GmailSendExecutor();
const slackSendMessageExecutor = new SlackSendMessageExecutor();
const telegramSendMessageExecutor = new TelegramSendMessageExecutor(env.telegramBotToken);
const notionCreatePageExecutor = new NotionCreatePageExecutor(env.notionApiToken);
const airtableCreateRecordExecutor = new AirtableCreateRecordExecutor(env.airtablePersonalAccessToken);
const outlookSendMailExecutor = new OutlookSendMailExecutor(env.microsoftGraphAccessToken);
const googleDriveCreateTextFileExecutor = new GoogleDriveCreateTextFileExecutor();
const resolveNodeExecutor: NodeExecutorResolver = (node) => node.name === "Webhook" || node.type === "trigger" && node.parameters.triggerKind === "webhook" ? webhookNodeExecutor : node.name === "Form Trigger" || node.type === "trigger" && node.parameters.triggerKind === "form" ? formTriggerNodeExecutor : node.name === "HTTP Request" ? httpRequestNodeExecutor : node.name === "Postgres" ? postgresNodeExecutor : node.name === "Google Sheets" ? googleSheetsAppendRowExecutor : node.name === "Google Drive" ? googleDriveCreateTextFileExecutor : node.name === "Gmail" ? gmailSendExecutor : node.name === "Slack" ? slackSendMessageExecutor : node.name === "Telegram" ? telegramSendMessageExecutor : node.name === "Notion" ? notionCreatePageExecutor : node.name === "Airtable" ? airtableCreateRecordExecutor : node.name === "Outlook" ? outlookSendMailExecutor : node.name === "File Input" ? fileInputNodeExecutor : typeof node.parameters.code === "string" ? codeNodeExecutor : undefined;

const repository = new PostgresWorkflowRepository({ connectionString: env.databaseUrl });
const credentialManager = new CredentialManager({ connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey));
const executionLogs = new ExecutionLogRepository({ connectionString: env.databaseUrl });
const progressPublisher = new Redis({ host: env.redisHost, port: env.redisPort, maxRetriesPerRequest: null });
const worker = createWorkflowWorker({
  redis: { host: env.redisHost, port: env.redisPort },
  repository,
  resolveNodeExecutor,
  concurrency: 25,
  beforeNodeExecute: async (node) => { for (const [type, id] of Object.entries(node.credentials)) if (type.toLowerCase().includes("oauth2")) await credentialManager.getValidAccessToken(id); },
  getCredentialAccessToken: async (credentialId) => credentialManager.getValidAccessToken(credentialId),
  onExecutionFinished: async (state) => { await executionLogs.save(state); await progressPublisher.publish(`workflow-progress:${state.id}`, JSON.stringify({ executionId: state.id, nodeId: "", status: state.status, completed: state.completedNodeIds.length, total: state.completedNodeIds.length + state.runningNodeIds.length, timestamp: new Date().toISOString() })); },
  onProgress: async (progress) => { await progressPublisher.publish(`workflow-progress:${progress.executionId}`, JSON.stringify(progress)); },
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; stopping workflow worker.`);
  await worker.close();
  await repository.close();
  await credentialManager.close();
  await workerDatabase.end();
  await progressPublisher.quit();
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
