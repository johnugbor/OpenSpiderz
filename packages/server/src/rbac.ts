import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { Pool, type PoolConfig } from "pg";
export type WorkspaceRole = "owner" | "admin" | "member" | "read_only";
export interface JwtIdentity { readonly sub: string; readonly email: string; }
declare module "@fastify/jwt" { interface FastifyJWT { payload: JwtIdentity; user: JwtIdentity; } }
export function registerJwtAuth(app: FastifyInstance, secret: string): void { app.register(jwt, { secret }); }
export function requireWorkspaceRole(config: PoolConfig, ...roles: readonly WorkspaceRole[]): preHandlerHookHandler { const pool = new Pool(config); return async (request: FastifyRequest) => { await request.jwtVerify(); const workspaceId = (request.params as { workspaceId?: string }).workspaceId; if (workspaceId === undefined) throw Object.assign(new Error("workspaceId is required."), { statusCode: 400 }); const result = await pool.query<{ role: WorkspaceRole }>("SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceId, request.user.sub]); const role = result.rows[0]?.role; if (role === undefined || !roles.includes(role)) throw Object.assign(new Error("Forbidden."), { statusCode: 403 }); }; }
