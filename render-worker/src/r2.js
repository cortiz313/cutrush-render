import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function downloadToFile({ bucket, key }, outPath) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    resp.Body.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
}

export async function uploadFromFile({ bucket, key }, inPath, contentType = "video/mp4") {
  const body = fs.createReadStream(inPath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}
