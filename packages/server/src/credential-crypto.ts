import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedCredential {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly keyVersion: number;
}

/** AES-256-GCM envelope encryption. Keep the 32-byte master key only in a secret manager. */
export class CredentialCrypto {
  private readonly key: Buffer;
  public constructor(base64Key: string, private readonly keyVersion = 1) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("Credential encryption key must be exactly 32 bytes after base64 decoding.");
  }

  public encrypt(plaintext: string): EncryptedCredential {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  public decrypt(encrypted: EncryptedCredential): string {
    if (encrypted.keyVersion !== this.keyVersion) throw new Error(`Credential was encrypted with unavailable key version ${encrypted.keyVersion}.`);
    const decipher = createDecipheriv("aes-256-gcm", this.key, encrypted.iv);
    decipher.setAuthTag(encrypted.authTag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
  }
}
