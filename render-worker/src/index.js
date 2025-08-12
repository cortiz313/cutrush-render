import "dotenv/config";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import axios from "axios";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { buildFfmpegArgs } from "./ffmpegGraph.js";

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ type: "*/*" })); // Accept any content type

app.post("/pubsub", async (req, res) => {
  res.status(204).end(); // Acknowledge Pub/Sub immediately

  try {
    const b64 = req.body?.message?.data;
    if (!b64) throw new Error("No Pub/Sub data");

    const decoded = Buffer.from(b64, "base64").toString("utf8");
    console.log("▶ Decoded JSON string:", decoded);

    let job;
    try {
      // Format 1: direct JSON string
      job = JSON.parse(decoded);
    } catch (err1) {
      try {
        // Format 2: nested base64 inside a JSON object
        const nested = JSON.parse(decoded);
        if (!nested?.data) throw new Error("Missing 'data' field");
        const innerDecoded = Buffer.from(nested.data, "base64").toString("utf8");
        console.log("▶ Nested decoded JSON string:", innerDecoded);
        job = JSON.parse(innerDecoded);
      } catch (err2) {
        throw new Error("Failed to parse job from both formats");
      }
    }

    await processJob(job);
  } catch (e) {
    console.error("❌ Job error:", e.message);
  }
});

async function processJob(job) {
  console.log("▶ Starting job:", job.jobId || "unknown");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  console.log("📁 Temp directory:", tmpDir);

  const aPath = path.join(tmpDir, "a.mp4");
  console.log("⬇️ Downloading A-roll:", job.aRoll.key);
  await downloadToFile({ bucket: job.aRoll.bucket, key: job.aRoll.key }, aPath);

  const inputs = [{ type: "a", path: aPath }];

  for (const br of job.bRoll) {
    const p = path.join(tmpDir, `${br.id}.mp4`);
    console.log("⬇️ Downloading B-roll:", br.key);
    await downloadToFile({ bucket: br.bucket, key: br.key }, p);
    inputs.push({ type: "b", id: br.id, path: p });
  }

  console.log("⚙️ Building ffmpeg args...");
  const { inputArgs, filterComplex, mapArgs } = buildFfmpegArgs({
    inputs,
    placements: job.placements,
  });

  const outPath = path.join(tmpDir, "out.mp4");
  const args = [
    ...inputArgs,
    "-filter_complex", filterComplex,
    ...mapArgs,
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "veryfast",
    "-crf", process.env.FFMPEG_CRF || "18",
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k",
    "-y", outPath,
  ];

  console.log("🎬 Running ffmpeg...");
  console.log("FFmpeg:", args.join(" "));
  const { stdout, stderr } = await execFileAsync("/usr/bin/ffmpeg", args, {
    timeout: (+process.env.MAX_RENDER_SECONDS || 3600) * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);

  console.log("⬆️ Uploading result to R2:", job.output.key);
  await uploadFromFile(
    { bucket: job.output.bucket, key: job.output.key },
    outPath,
    "video/mp4"
  );

  if (job.webhook?.url) {
    console.log("📡 Sending callback to:", job.webhook.url);
    try {
      await axios.post(job.webhook.url, {
        projectId: job.projectId,
        userId: job.userId,
        outputUrl: `${process.env.PUBLIC_R2_BASE}/${job.output.key}`,
        status: "completed",
      }, {
        headers: {
          "Content-Type": "application/json",
          "X-Callback-Signature": process.env.CALLBACK_SECRET || "",
        },
        timeout: 10000,
      });
    } catch (e) {
      console.error("❌ Callback failed:", e?.response?.status, e?.response?.data || e.message);
    }
  }

  try {
    console.log("🧹 Cleaning up temp dir...");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("⚠️ Cleanup failed:", err.message);
  }
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`render-worker on :${port}`));
