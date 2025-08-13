export function buildFfmpegArgs({ inputs, placements }) {
  const aIndex = 0;
  const bIndexById = {};
  let idx = 1;

  // Map B-roll IDs to FFmpeg input indices
  for (const i of inputs) {
    if (i.type === "b") {
      bIndexById[i.id] = idx++;
    }
  }

  const chains = [];
  let baseLabel = "base0";
  let currentLabel = baseLabel;
  let overlayCount = 0;

  // Base layer from A-roll
  chains.push(`[${aIndex}:v]setpts=PTS-STARTPTS,format=yuv420p[${baseLabel}]`);

  for (const p of placements) {
    const bIdx = bIndexById[p.brollId];
    if (bIdx == null) {
      console.warn(`⚠️ Skipping placement with unknown brollId: ${p.brollId}`);
      continue;
    }

    const enable = `between(t\\,${p.start}\\,${p.end})`;
    const bInLabel = `b${overlayCount}`;
    const outLabel = `ov${overlayCount}`;
    const scale = (p.w && p.h) ? `,scale=${p.w}:${p.h}` : "";

    // Prepare B-roll video
    chains.push(`[${bIdx}:v]setpts=PTS-STARTPTS${scale}[${bInLabel}]`);

    // Determine overlay mode
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    const overlay = p.mode === "cutaway"
      ? `overlay=enable='${enable}':x=0:y=0`
      : `overlay=enable='${enable}':x=${x}:y=${y}`;

    chains.push(`[${currentLabel}][${bInLabel}]${overlay}[${outLabel}]`);
    currentLabel = outLabel;
    overlayCount++;
  }

  const filterComplex = chains.join(";");

  return {
    inputArgs: inputs.flatMap(i => ["-i", i.path]),
    filterComplex,
    mapArgs: ["-map", `[${currentLabel}]`, "-map", `${aIndex}:a?`],
  };
}
