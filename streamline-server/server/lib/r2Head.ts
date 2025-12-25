import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "./r2";

export async function r2HeadObjectSize(key: string): Promise<number> {
  try {
    const resp = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
  } catch (err) {
    return 0;
  }
}
