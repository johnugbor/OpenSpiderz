import { createWorkflowWorker, PostgresWorkflowRepository, type NodeExecutorResolver } from "@spiderz/core";
import { CodeNodeExecutor } from "@spiderz/nodes";
import { loadEnvironment } from "./environment.js";
import { CredentialCrypto } from "./credential-crypto.js";
import { CredentialManager } from "./credential-manager.js";

const codeNodeExecutor = new CodeNodeExecutor();
const resolveNodeExecutor: NodeExecutorResolver = (node) => typeof node.parameters.code === "string" ? codeNodeExecutor : undefined;

const env = loadEnvironment();
const repository = new PostgresWorkflowRepository({ connectionString: env.databaseUrl });
const credentialManager = new CredentialManager({ connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey));
const worker = createWorkflowWorker({
  redis: { host: env.redisHost, port: env.redisPort },
  repository,
  resolveNodeExecutor,
  concurrency: 25,
  beforeNodeExecute: async (node) => { for (const [type, id] of Object.entries(node.credentials)) if (type.toLowerCase().includes("oauth2")) await credentialManager.getValidAccessToken(id); },
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; stopping workflow worker.`);
  await worker.close();
  await repository.close();
  await credentialManager.close();
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
