import "dotenv/config";
import express from "express";
import helmet from "helmet";
import Joi from "joi";
import { PubSub } from "@google-cloud/pubsub";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

const pubsub = new PubSub();
const topicName = process.env.PUBSUB_TOPIC || "render-jobs";

function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  if (!hdr.startsWith("Bearer ")) return res.status(401).json({ error: "no token" });
  const token = hdr.substring(7);
  if (token !== process.env.ENQUEUE_SHARED_SECRET) return res.status(403).json({ error: "bad token" });
  next();
}

const schema = Joi.object({
  projectId: Joi.string().required(),
  userId: Joi.string().required(),
  aRoll: Joi.object({ bucket: Joi.string().required(), key: Joi.string().required() }).required(),
  bRoll: Joi.array().items(Joi.object({ id: Joi.string().required(), bucket: Joi.string().required(), key: Joi.string().required() })).required(),
  placements: Joi.array().items(Joi.object({
    brollId: Joi.string().required(),
    mode: Joi.string().valid("cutaway","pip").required(),
    start: Joi.number().min(0).required(),
    end: Joi.number().greater(Joi.ref("start")).required(),
    x: Joi.alternatives().try(Joi.string(), Joi.number()),
    y: Joi.alternatives().try(Joi.string(), Joi.number()),
    w: Joi.number(),
    h: Joi.number()
  })).required(),
  output: Joi.object({ bucket: Joi.string().required(), key: Joi.string().required() }).required(),
  webhook: Joi.object({ url: Joi.string().uri().required() }).required()
});

app.post("/enqueue", auth, async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const dataBuffer = Buffer.from(JSON.stringify(value));
    const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
    res.json({ ok: true, messageId });
  } catch (e) {
    console.error("enqueue error:", e);
    res.status(500).json({ error: "enqueue failed" });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`queue-api on :${port}`));
