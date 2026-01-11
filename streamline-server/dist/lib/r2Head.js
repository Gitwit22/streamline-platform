"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2HeadObjectSize = r2HeadObjectSize;
const client_s3_1 = require("@aws-sdk/client-s3");
const r2_1 = require("./r2");
async function r2HeadObjectSize(key) {
    try {
        const resp = await r2_1.r2.send(new client_s3_1.HeadObjectCommand({ Bucket: r2_1.R2_BUCKET, Key: key }));
        return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
    }
    catch (err) {
        return 0;
    }
}
