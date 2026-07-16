import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies `x-spiderz-signature: sha256=<hex>` against the unparsed request body. */
export class WebhookSignatureVerifier {
  public verify(rawBody: Buffer, suppliedHeader: string | undefined, secret: string): boolean {
    if (suppliedHeader === undefined || !suppliedHeader.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const supplied = suppliedHeader.slice("sha256=".length);
    const expectedBytes = Buffer.from(expected, "hex");
    const suppliedBytes = Buffer.from(supplied, "hex");
    return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
  }
}
