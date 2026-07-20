import type { BinaryStorageDriver } from "@spiderz/core";
import { LocalBinaryStorage } from "./local-binary-storage.js";
import { S3BinaryStorage } from "./s3-binary-storage.js";
import type { RuntimeEnvironment } from "./environment.js";
export function createBinaryStorage(env: RuntimeEnvironment): BinaryStorageDriver {
  if (env.binaryStorageDriver === "local") return new LocalBinaryStorage(env.binaryLocalPath);
  if (env.s3Bucket === undefined || env.s3Region === undefined || env.s3AccessKeyId === undefined || env.s3SecretAccessKey === undefined) throw new Error("S3 binary storage configuration is incomplete.");
  return new S3BinaryStorage({ bucket: env.s3Bucket, region: env.s3Region, ...(env.s3Endpoint === undefined ? {} : { endpoint: env.s3Endpoint }), forcePathStyle: env.s3ForcePathStyle, credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey } });
}
