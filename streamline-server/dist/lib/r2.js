"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2 = exports.R2_BUCKET = void 0;
exports.r2GetStream = r2GetStream;
exports.r2Delete = r2Delete;
const client_s3_1 = require("@aws-sdk/client-s3");
function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
exports.R2_BUCKET = mustGetEnv("R2_BUCKET");
exports.r2 = new client_s3_1.S3Client({
    region: "auto",
    endpoint: `https://${mustGetEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: mustGetEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: mustGetEnv("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
});
async function r2GetStream(key) {
    const resp = await exports.r2.send(new client_s3_1.GetObjectCommand({ Bucket: exports.R2_BUCKET, Key: key }));
    return resp.Body; // Readable stream
}
async function r2Delete(key) {
    await exports.r2.send(new client_s3_1.DeleteObjectCommand({ Bucket: exports.R2_BUCKET, Key: key }));
}
