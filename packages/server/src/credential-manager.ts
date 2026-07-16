import { Pool, type PoolConfig } from "pg";
import { CredentialCrypto, type EncryptedCredential } from "./credential-crypto.js";

export interface OAuth2Secrets { readonly clientId: string; readonly clientSecret: string; readonly accessToken: string; readonly refreshToken: string; }
export interface OAuth2Credential { readonly id: string; readonly provider: string; readonly tokenUrl: string; readonly secrets: OAuth2Secrets; readonly expiresAt: Date; }
interface StoredCredential { readonly id: string; readonly provider: string; readonly token_url: string; readonly secret_ciphertext: Buffer; readonly secret_iv: Buffer; readonly secret_auth_tag: Buffer; readonly key_version: number; readonly expires_at: Date; }

/** Serializes refreshes with SELECT ... FOR UPDATE so workers never race token rotation. */
export class CredentialManager {
  private readonly pool: Pool;
  public constructor(config: PoolConfig, private readonly crypto: CredentialCrypto) { this.pool = new Pool(config); }
  public async getValidAccessToken(credentialId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<StoredCredential>("SELECT * FROM oauth2_credentials WHERE id=$1 FOR UPDATE", [credentialId]);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`OAuth2 credential '${credentialId}' was not found.`);
      const current = this.decrypt(row);
      if (current.expiresAt.getTime() > Date.now() + 300_000) { await client.query("COMMIT"); return current.secrets.accessToken; }
      const refreshed = await this.refresh(current);
      const encrypted = this.crypto.encrypt(JSON.stringify(refreshed.secrets));
      await client.query("UPDATE oauth2_credentials SET secret_ciphertext=$2,secret_iv=$3,secret_auth_tag=$4,key_version=$5,expires_at=$6,updated_at=now() WHERE id=$1", [credentialId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, refreshed.expiresAt]);
      await client.query("COMMIT");
      return refreshed.secrets.accessToken;
    } catch (error: unknown) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  public async close(): Promise<void> { await this.pool.end(); }
  private decrypt(row: StoredCredential): OAuth2Credential { const encrypted: EncryptedCredential = { ciphertext: row.secret_ciphertext, iv: row.secret_iv, authTag: row.secret_auth_tag, keyVersion: row.key_version }; return { id: row.id, provider: row.provider, tokenUrl: row.token_url, secrets: JSON.parse(this.crypto.decrypt(encrypted)) as OAuth2Secrets, expiresAt: row.expires_at }; }
  private async refresh(current: OAuth2Credential): Promise<OAuth2Credential> {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.secrets.refreshToken, client_id: current.secrets.clientId, client_secret: current.secrets.clientSecret });
    const response = await fetch(current.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`OAuth2 refresh for ${current.provider} failed (${response.status}).`);
    const payload = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") throw new Error(`OAuth2 provider ${current.provider} returned an invalid token response.`);
    return { ...current, secrets: { ...current.secrets, accessToken: payload.access_token, ...(typeof payload.refresh_token === "string" ? { refreshToken: payload.refresh_token } : {}) }, expiresAt: new Date(Date.now() + payload.expires_in * 1_000) };
  }
}
