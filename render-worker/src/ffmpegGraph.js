export function buildFfmpegArgs({ inputs, placements }) {
  const aIndex = 0;
  const bIndexById = {};
  let idx = 1;
  for (const i of inputs) if (i.type === "b") bIndexById[i.id] = idx++;

  const chains = [];
  let baseLabel = "base0";
  chains.push(`[${aIndex}:v]setpts=PTS-STARTPTS,format=yuv420p[${baseLabel}]`);
  let currentLabel = baseLabel;
  let overlayCount = 0;

  for (const p of placements) {
    const bIdx = bIndexById[p.brollId];
    if (bIdx == null) continue;

    const enable = `between(t\\,${p.start}\\,${p.end})`;
    const thisIn = `b${overlayCount}`;
    const scale = (p.w && p.h) ? `,scale=${p.w}:${p.h}` : "";
    chains.push(`[${bIdx}:v]setpts=PTS-STARTPTS${scale}[${thisIn}]`);

    const x = p.x ?? 0, y = p.y ?? 0;
    const out = `ov${overlayCount}`;
    if (p.mode === "cutaway") {
      chains.push(`[${currentLabel}][${thisIn}]overlay=enable='${enable}':x=0:y=0[${out}]`);
    } else {
      chains.push(`[${currentLabel}][${thisIn}]overlay=enable='${enable}':x=${x}:y=${y}[${out}]`);
    }
    currentLabel = out;
    overlayCount++;
  }

  const filterComplex = chains.join(";");

  return {
    inputArgs: inputs.map(i => ["-i", i.path]).flat(),
    filterComplex,
    mapArgs: ["-map", `[${currentLabel}]`, "-map", `${aIndex}:a?`]
  };
}
