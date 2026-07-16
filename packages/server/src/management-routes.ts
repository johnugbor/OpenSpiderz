import type { FastifyInstance } from "fastify";
import type { PoolConfig } from "pg";
import { DeploymentService } from "./deployment-service.js";
import { requireWorkspaceRole } from "./rbac.js";

interface DeploymentParams { readonly workspaceId: string; }
interface DeploymentBody { readonly sourceVersionId: string; readonly productionWorkflowId: string; }

/** Management routes require a JWT and an owner/admin workspace membership. */
export function registerManagementRoutes(app: FastifyInstance, database: PoolConfig): void {
  const deployments = new DeploymentService(database);
  app.post<{ Params: DeploymentParams; Body: DeploymentBody }>("/api/workspaces/:workspaceId/deployments", {
    preHandler: requireWorkspaceRole(database, "owner", "admin"),
    handler: async (request, reply) => {
      const { sourceVersionId, productionWorkflowId } = request.body;
      if (!isUuid(sourceVersionId) || !isUuid(productionWorkflowId)) return reply.code(400).send({ error: "Invalid deployment identifiers." });
      await deployments.deploy(sourceVersionId, productionWorkflowId, request.user.sub);
      return reply.code(201).send({ status: "deployed" });
    },
  });
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
