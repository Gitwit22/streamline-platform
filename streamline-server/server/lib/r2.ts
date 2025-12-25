import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const R2_BUCKET = mustGetEnv("R2_BUCKET");

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${mustGetEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: mustGetEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: mustGetEnv("R2_SECRET_ACCESS_KEY"),
  },
});

export async function r2GetStream(key: string) {
  const resp = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return resp.Body; // Readable stream
}

export async function r2Delete(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
