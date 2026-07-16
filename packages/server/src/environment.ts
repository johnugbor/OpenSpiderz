import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { CredentialCrypto } from "./credential-crypto.js";

// npm workspace scripts run from packages/server; resolve the repository root explicitly.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export interface RuntimeEnvironment {
  readonly databaseUrl: string;
  readonly credentialEncryptionKey: string;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly host: string;
  readonly port: number;
}

export function loadEnvironment(): RuntimeEnvironment {
  const databaseUrl = required("DATABASE_URL");
  const credentialEncryptionKey = required("CREDENTIAL_ENCRYPTION_KEY");
  new CredentialCrypto(credentialEncryptionKey); // Validate key shape before accepting traffic.
  return {
    databaseUrl,
    credentialEncryptionKey,
    redisHost: process.env.REDIS_HOST ?? "127.0.0.1",
    redisPort: positiveInteger(process.env.REDIS_PORT ?? "6379", "REDIS_PORT"),
    host: process.env.HOST ?? "0.0.0.0",
    port: positiveInteger(process.env.PORT ?? "3000", "PORT"),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} must be an integer between 1 and 65535.`);
  return parsed;
}
