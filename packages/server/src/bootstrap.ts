import Fastify from "fastify";
import { loadEnvironment } from "./environment.js";
import { QueueManager } from "./queue-manager.js";
import { registerWebhookListener } from "./webhook-listener.js";
import { WorkflowRepository } from "./workflow-repository.js";
import { registerJwtAuth } from "./rbac.js";
import { registerManagementRoutes } from "./management-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerOrganizationRoutes } from "./organization-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";
import { registerMemberRoutes } from "./member-routes.js";

declare module "fastify" { interface FastifyRequest { rawBody?: Buffer; } }

export async function startApiServer(): Promise<void> {
  const env = loadEnvironment();
  const app = Fastify({ logger: true, bodyLimit: 1_048_576, trustProxy: true });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    try { done(null, rawBody.length === 0 ? null : JSON.parse(rawBody.toString("utf8"))); }
    catch (error: unknown) { done(error as Error, undefined); }
  });
  const repository = new WorkflowRepository({ connectionString: env.databaseUrl });
  registerJwtAuth(app, env.jwtSecret);
  registerAuthRoutes(app, { connectionString: env.databaseUrl });
  registerOrganizationRoutes(app, { connectionString: env.databaseUrl });
  registerWorkflowRoutes(app, { connectionString: env.databaseUrl });
  registerMemberRoutes(app, { connectionString: env.databaseUrl });
  registerManagementRoutes(app, { connectionString: env.databaseUrl });
  const queue = new QueueManager({ redis: { host: env.redisHost, port: env.redisPort } });
  registerWebhookListener(app, repository, queue, env.webhookSigningSecret);
  app.get("/health", async () => ({ status: "ok" }));
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error." });
  });
  app.addHook("onClose", async () => { await Promise.all([queue.close(), repository.close()]); });
  await app.listen({ host: env.host, port: env.port });
}

void startApiServer().catch((error: unknown) => {
  console.error("API server failed to start", error);
  process.exitCode = 1;
});
