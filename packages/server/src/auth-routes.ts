import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { Pool, type PoolConfig } from "pg";

const scrypt = promisify(scryptCallback);
interface Credentials { readonly email: string; readonly password: string; }
export function registerAuthRoutes(app: FastifyInstance, database: PoolConfig): void {
  const pool = new Pool(database);
  app.post<{ Body: Credentials }>("/api/auth/register", async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || request.body.password.length < 12) return reply.code(400).send({ error: "Use a valid email and password of at least 12 characters." });
    try { const result = await pool.query<{ id: string }>("INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id", [email, await hashPassword(request.body.password)]); const userId = result.rows[0]?.id; if (userId === undefined) throw new Error("User creation did not return an ID."); return reply.code(201).send({ accessToken: app.jwt.sign({ sub: userId, email }) }); }
    catch (error: unknown) { if (isUniqueViolation(error)) return reply.code(409).send({ error: "Email already registered." }); throw error; }
  });
  app.post<{ Body: Credentials }>("/api/auth/login", async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const result = await pool.query<{ id: string; password_hash: string }>("SELECT id,password_hash FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (user === undefined || !await verifyPassword(request.body.password, user.password_hash)) return reply.code(401).send({ error: "Invalid email or password." });
    return { accessToken: app.jwt.sign({ sub: user.id, email }) };
  });
}
async function hashPassword(password: string): Promise<string> { const salt = randomBytes(16); const derived = await scrypt(password, salt, 64) as Buffer; return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`; }
async function verifyPassword(password: string, stored: string): Promise<boolean> { const [algorithm, saltText, hashText] = stored.split("$"); if (algorithm !== "scrypt" || saltText === undefined || hashText === undefined) return false; const expected = Buffer.from(hashText, "base64"), actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length) as Buffer; return actual.length === expected.length && timingSafeEqual(actual, expected); }
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"; }
