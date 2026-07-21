import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadEnvironment } from "./environment.js";
import { QueueManager } from "./queue-manager.js";
import { registerWebhookListener } from "./webhook-listener.js";
import { registerFormListener } from "./form-listener.js";
import { WorkflowRepository } from "./workflow-repository.js";
import { registerJwtAuth } from "./rbac.js";
import { registerManagementRoutes } from "./management-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerOrganizationRoutes } from "./organization-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";
import { createBinaryStorage } from "./binary-storage-factory.js";
import { cleanupOrphanedBinaryData } from "./binary-cleanup-worker.js";
import { BinaryDataManager } from "@spiderz/core";
import { registerUploadRoutes } from "./upload-routes.js";
import { registerExecutionRoutes } from "./execution-routes.js";
import { registerMemberRoutes } from "./member-routes.js";
import { registerCredentialRoutes } from "./credential-routes.js";
import { registerGoogleOAuthRoutes } from "./google-oauth-routes.js";
import { registerSlackOAuthRoutes } from "./slack-oauth-routes.js";
import { registerNotionOAuthRoutes } from "./notion-oauth-routes.js";
import { registerAirtableOAuthRoutes } from "./airtable-oauth-routes.js";
import { registerOutlookOAuthRoutes } from "./outlook-oauth-routes.js";
import { CredentialCrypto } from "./credential-crypto.js";

declare module "fastify" { interface FastifyRequest { rawBody?: Buffer; } }

export async function startApiServer(): Promise<void> {
  const env = loadEnvironment();
  const app = Fastify({ logger: true, bodyLimit: 1_048_576, trustProxy: true });
  await app.register(cors, { origin: env.corsOrigin, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    try { done(null, rawBody.length === 0 ? null : JSON.parse(rawBody.toString("utf8"))); }
    catch (error: unknown) { done(error as Error, undefined); }
  });
  const repository = new WorkflowRepository({ connectionString: env.databaseUrl });
  const binaryStorage = createBinaryStorage(env);
  registerUploadRoutes(app, { connectionString: env.databaseUrl }, new BinaryDataManager(binaryStorage));
  const queue = new QueueManager({ redis: { host: env.redisHost, port: env.redisPort } });
  registerExecutionRoutes(app, { connectionString: env.databaseUrl }, queue);
  const cleanup = setInterval(() => { void cleanupOrphanedBinaryData(binaryStorage, env.binaryRetentionDays).catch((error: unknown) => app.log.error(error)); }, 86_400_000);
  registerJwtAuth(app, env.jwtSecret);
  registerAuthRoutes(app, { connectionString: env.databaseUrl });
  registerOrganizationRoutes(app, { connectionString: env.databaseUrl });
  registerWorkflowRoutes(app, { connectionString: env.databaseUrl });
  registerMemberRoutes(app, { connectionString: env.databaseUrl });
  registerCredentialRoutes(app, { connectionString: env.databaseUrl });
  registerGoogleOAuthRoutes(app, { connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey), { clientId: env.googleOAuthClientId, clientSecret: env.googleOAuthClientSecret, redirectUri: env.googleOAuthRedirectUri });
  registerSlackOAuthRoutes(app, { connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey), env.slackOAuthClientId !== undefined && env.slackOAuthClientSecret !== undefined && env.slackOAuthRedirectUri !== undefined ? { clientId: env.slackOAuthClientId, clientSecret: env.slackOAuthClientSecret, redirectUri: env.slackOAuthRedirectUri } : undefined);
  registerNotionOAuthRoutes(app, { connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey), env.notionOAuthClientId !== undefined && env.notionOAuthClientSecret !== undefined && env.notionOAuthRedirectUri !== undefined ? { clientId: env.notionOAuthClientId, clientSecret: env.notionOAuthClientSecret, redirectUri: env.notionOAuthRedirectUri } : undefined);
  registerAirtableOAuthRoutes(app, { connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey), env.airtableOAuthClientId !== undefined && env.airtableOAuthClientSecret !== undefined && env.airtableOAuthRedirectUri !== undefined ? { clientId: env.airtableOAuthClientId, clientSecret: env.airtableOAuthClientSecret, redirectUri: env.airtableOAuthRedirectUri } : undefined);
  registerOutlookOAuthRoutes(app, { connectionString: env.databaseUrl }, new CredentialCrypto(env.credentialEncryptionKey), env.microsoftOAuthClientId !== undefined && env.microsoftOAuthClientSecret !== undefined && env.microsoftOAuthRedirectUri !== undefined ? { clientId: env.microsoftOAuthClientId, clientSecret: env.microsoftOAuthClientSecret, redirectUri: env.microsoftOAuthRedirectUri } : undefined);
  registerManagementRoutes(app, { connectionString: env.databaseUrl });
  registerWebhookListener(app, repository, queue, env.webhookSigningSecret);
  registerFormListener(app, repository, queue);
  app.get("/health", async () => ({ status: "ok" }));
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error." });
  });
  app.addHook("onClose", async () => { clearInterval(cleanup); await Promise.all([queue.close(), repository.close()]); });
  await app.listen({ host: env.host, port: env.port });
}

void startApiServer().catch((error: unknown) => {
  console.error("API server failed to start", error);
  process.exitCode = 1;
});
