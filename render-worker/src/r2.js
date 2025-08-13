import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { pipeline } from "stream/promises";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export async function downloadToFile({ bucket, key }, outPath) {
  const url = `${process.env.PUBLIC_R2_BASE}/${key}`;
  console.log(`⬇️ Streaming download from ${url} → ${outPath}`);

  try {
    const response = await axios.get(url, { responseType: "stream" });
    await pipeline(response.data, fs.createWriteStream(outPath));
    console.log(`✅ Download complete: ${outPath}`);
  } catch (err) {
    console.error(`❌ Failed to download from ${url}:`, err.message);
    throw err;
  }
}

// Efficient upload with streaming
export async function uploadFromFile({ bucket, key }, inPath, contentType = "video/mp4") {
  console.log(`⬆️ Uploading ${inPath} → ${bucket}/${key}`);
  const body = fs.createReadStream(inPath);

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    console.log(`✅ Upload complete: ${bucket}/${key}`);
  } catch (err) {
    console.error(`❌ Failed to upload ${key}:`, err);
    throw err;
  }
}
