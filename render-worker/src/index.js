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
app.use(express.json({ type: "*/*" })); // Pub/Sub push JSON

app.post("/pubsub", async (req, res) => {
  res.status(204).end(); // ack early
  try {
    const b64 = req.body?.message?.data;
    if (!b64) throw new Error("No Pub/Sub data");

    // ✅ Proper base64 decode and JSON parse
    const rawJson = Buffer.from(b64, "base64").toString("utf8");
    const job = JSON.parse(rawJson);

    await processJob(job);
  } catch (e) {
    console.error("Job error:", e);
  }
});

async function processJob(job) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  const aPath = path.join(tmpDir, "a.mp4");
  await downloadToFile({ bucket: job.aRoll.bucket, key: job.aRoll.key }, aPath);

  const inputs = [{ type: "a", path: aPath }];
  for (const br of job.bRoll) {
    const p = path.join(tmpDir, `${br.id}.mp4`);
    await downloadToFile({ bucket: br.bucket, key: br.key }, p);
    inputs.push({ type: "b", id: br.id, path: p });
  }

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

  console.log("FFmpeg:", args.join(" "));
  const { stdout, stderr } = await execFileAsync("/usr/bin/ffmpeg", args, {
    timeout: (+process.env.MAX_RENDER_SECONDS || 3600) * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.log(stderr);

  await uploadFromFile(
    { bucket: job.output.bucket, key: job.output.key },
    outPath,
    "video/mp4"
  );

  // 🔁 Optional callback to webhook
  if (job.webhook?.url) {
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
      console.error("Callback failed:", e?.response?.status, e?.response?.data || e.message);
    }
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`render-worker on :${port}`));
