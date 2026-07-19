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
  readonly webhookSigningSecret: string;
  readonly jwtSecret: string;
  readonly corsOrigin: string;
  readonly binaryStorageDriver: "local" | "s3";
  readonly binaryLocalPath: string;
  readonly binaryRetentionDays: number;
  readonly s3Bucket?: string;
  readonly s3Region?: string;
  readonly s3Endpoint?: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId?: string;
  readonly s3SecretAccessKey?: string;
  readonly googleOAuthClientId: string;
  readonly googleOAuthClientSecret: string;
  readonly googleOAuthRedirectUri: string;
  readonly slackOAuthClientId?: string;
  readonly slackOAuthClientSecret?: string;
  readonly slackOAuthRedirectUri?: string;
  readonly telegramBotToken?: string;
  readonly notionApiToken?: string;
  readonly airtablePersonalAccessToken?: string;
  readonly microsoftGraphAccessToken?: string;
}

export function loadEnvironment(): RuntimeEnvironment {
  const databaseUrl = required("DATABASE_URL");
  const credentialEncryptionKey = required("CREDENTIAL_ENCRYPTION_KEY");
  new CredentialCrypto(credentialEncryptionKey); // Validate key shape before accepting traffic.
  const binaryStorageDriver = process.env.BINARY_STORAGE_DRIVER === "s3" ? "s3" : "local";
  const endpoint = process.env.S3_ENDPOINT;
  const s3 = binaryStorageDriver === "s3" ? { s3Bucket: required("S3_BUCKET"), s3Region: required("S3_REGION"), ...(endpoint === undefined ? {} : { s3Endpoint: endpoint }), s3AccessKeyId: required("S3_ACCESS_KEY_ID"), s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY") } : {};
  return {
    databaseUrl,
    credentialEncryptionKey,
    redisHost: process.env.REDIS_HOST ?? "127.0.0.1",
    redisPort: positiveInteger(process.env.REDIS_PORT ?? "6379", "REDIS_PORT"),
    host: process.env.HOST ?? "0.0.0.0",
    port: positiveInteger(process.env.PORT ?? "3000", "PORT"),
    webhookSigningSecret: required("WEBHOOK_SIGNING_SECRET"),
    jwtSecret: required("JWT_SECRET"),
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    binaryStorageDriver,
    binaryLocalPath: process.env.BINARY_LOCAL_PATH ?? "./data/binary",
    binaryRetentionDays: positiveInteger(process.env.BINARY_RETENTION_DAYS ?? "30", "BINARY_RETENTION_DAYS"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    googleOAuthClientId: required("GOOGLE_OAUTH_CLIENT_ID"),
    googleOAuthClientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    googleOAuthRedirectUri: required("GOOGLE_OAUTH_REDIRECT_URI"),
    ...(process.env.SLACK_OAUTH_CLIENT_ID === undefined || process.env.SLACK_OAUTH_CLIENT_SECRET === undefined || process.env.SLACK_OAUTH_REDIRECT_URI === undefined ? {} : { slackOAuthClientId: process.env.SLACK_OAUTH_CLIENT_ID, slackOAuthClientSecret: process.env.SLACK_OAUTH_CLIENT_SECRET, slackOAuthRedirectUri: process.env.SLACK_OAUTH_REDIRECT_URI }),
    ...(process.env.TELEGRAM_BOT_TOKEN === undefined ? {} : { telegramBotToken: process.env.TELEGRAM_BOT_TOKEN }),
    ...(process.env.NOTION_API_TOKEN === undefined ? {} : { notionApiToken: process.env.NOTION_API_TOKEN }),
    ...(process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN === undefined ? {} : { airtablePersonalAccessToken: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN }),
    ...(process.env.MICROSOFT_GRAPH_ACCESS_TOKEN === undefined ? {} : { microsoftGraphAccessToken: process.env.MICROSOFT_GRAPH_ACCESS_TOKEN }),
    ...s3,
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
