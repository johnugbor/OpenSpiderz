import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { BinaryDataManager } from "@spiderz/core";
import type { PoolConfig } from "pg";
import { Pool } from "pg";
import { requireWorkspaceRole } from "./rbac.js";

export function registerUploadRoutes(app: FastifyInstance, database: PoolConfig, binary: BinaryDataManager): void {
  const pool = new Pool(database);
  app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  app.post<{ Params: { workspaceId: string } }>("/api/workspaces/:workspaceId/files", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member") }, async (request, reply) => {
    const file = await request.file();
    if (file === undefined) return reply.code(400).send({ error: "A multipart file field is required." });
    const reference = await binary.store(file.file, { mimeType: file.mimetype || "application/octet-stream", fileName: file.filename || "upload" });
    if (file.file.truncated) { await binary.delete(reference); return reply.code(413).send({ error: "File exceeds the 100 MiB limit." }); }
    await pool.query("INSERT INTO binary_assets(data_id,workspace_id,mime_type,file_name,file_size) VALUES($1,$2,$3,$4,$5)", [reference.dataId, request.params.workspaceId, reference.mimeType, reference.fileName, reference.fileSize]);
    return reply.code(201).send(reference);
  });
  app.get<{ Params: { workspaceId: string; dataId: string } }>("/api/workspaces/:workspaceId/files/:dataId", { preHandler: requireWorkspaceRole(database, "owner", "admin", "member", "read_only") }, async (request, reply) => {
    const result = await pool.query<{ data_id: string; mime_type: string; file_name: string; file_size: number }>("SELECT data_id,mime_type,file_name,file_size FROM binary_assets WHERE data_id=$1 AND workspace_id=$2", [request.params.dataId, request.params.workspaceId]);
    const asset = result.rows[0];
    if (asset === undefined) return reply.code(404).send({ error: "File not found." });
    const stream = await binary.open({ dataId: asset.data_id, mimeType: asset.mime_type, fileName: asset.file_name, fileSize: asset.file_size });
    reply.header("content-type", asset.mime_type).header("content-disposition", `attachment; filename="${asset.file_name.replaceAll('"', "")}"`);
    return reply.send(stream);
  });
}
