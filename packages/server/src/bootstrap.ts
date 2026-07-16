import Fastify from "fastify";
import { loadEnvironment } from "./environment.js";
import { QueueManager } from "./queue-manager.js";
import { registerWebhookListener } from "./webhook-listener.js";
import { WorkflowRepository } from "./workflow-repository.js";

export async function startApiServer(): Promise<void> {
  const env = loadEnvironment();
  const app = Fastify({ logger: true, bodyLimit: 1_048_576, trustProxy: true });
  const repository = new WorkflowRepository({ connectionString: env.databaseUrl });
  const queue = new QueueManager({ redis: { host: env.redisHost, port: env.redisPort } });
  registerWebhookListener(app, repository, queue);
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
