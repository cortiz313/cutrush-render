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

// Efficient download with logging and proper stream handling
export async function downloadToFile({ bucket, key }, outPath) {
  console.log(`⬇️ Downloading ${bucket}/${key} → ${outPath}`);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });

  try {
    const response = await s3.send(command);
    const bodyStream = response.Body;

    await pipeline(bodyStream, fs.createWriteStream(outPath));
    console.log(`✅ Download complete: ${outPath}`);
  } catch (err) {
    console.error(`❌ Failed to download ${key}:`, err);
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
