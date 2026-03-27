function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function createSeededRandom(seedInput) {
  let state = (seedInput >>> 0) || 1;
  return function seededRandom() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sampleUniqueCells(width, height, count, rand) {
  const maxCells = width * height;
  const targetCount = Math.max(0, Math.min(maxCells, count));
  const picked = new Set();
  const cells = [];

  while (cells.length < targetCount) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * height);
    const key = y * width + x;
    if (picked.has(key)) continue;
    picked.add(key);
    cells.push({ x, y });
  }

  return cells;
}

function getSubcellRect(srcX, srcY, subdiv, index) {
  const step = 1 / subdiv;
  const subX = index % subdiv;
  const subY = Math.floor(index / subdiv);
  return {
    x: srcX + subX * step,
    y: srcY + subY * step,
    w: step,
    h: step,
  };
}

function pushSpillRect(rects, srcX, srcY, subRect, dir, spillStrength, rand) {
  const baseSpill = 0.12 + spillStrength * 0.65;
  const spill = baseSpill * (0.8 + rand() * 0.4);

  if (dir === 0) {
    rects.push({ srcX, srcY, x: subRect.x + subRect.w, y: subRect.y, w: spill, h: subRect.h });
  } else if (dir === 1) {
    rects.push({ srcX, srcY, x: subRect.x - spill, y: subRect.y, w: spill, h: subRect.h });
  } else if (dir === 2) {
    rects.push({ srcX, srcY, x: subRect.x, y: subRect.y - spill, w: subRect.w, h: spill });
  } else {
    rects.push({ srcX, srcY, x: subRect.x, y: subRect.y + subRect.h, w: subRect.w, h: spill });
  }
}

function buildTransitionPlan(meta, renderInfo, intensity, glitch) {
  const seed = (((meta.cycleIndex + 1) * 2654435761) ^ 0xa5f1523d) >>> 0;
  const rand = createSeededRandom(seed);
  const maxCells = clampInt(glitch.maxCellsPerBlend, 1, 12, 2);
  const subdiv = clampInt(glitch.subdiv, 1, 2, 2);
  const spillStrength = clamp(glitch.spillStrength ?? 0.45, 0.05, 1);
  const touchedCells = Math.max(1, Math.min(maxCells, 1 + Math.floor(rand() * maxCells)));
  const cells = sampleUniqueCells(renderInfo.baseWidth, renderInfo.baseHeight, touchedCells, rand);
  const rects = [];

  for (const cell of cells) {
    const subcellCount = subdiv * subdiv;
    const localCount = Math.max(1, Math.min(subcellCount, 1 + Math.floor(rand() * (1 + intensity * subcellCount))));
    const selected = sampleUniqueCells(subdiv, subdiv, localCount, rand);
    const dir = Math.floor(rand() * 4);
    for (const local of selected) {
      const subRect = getSubcellRect(cell.x, cell.y, subdiv, local.y * subdiv + local.x);
      pushSpillRect(rects, cell.x, cell.y, subRect, dir, spillStrength, rand);
    }
  }

  return rects;
}

function colorAtCell(pixels, width, x, y) {
  const i = (y * width + x) * 3;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

export function createErrorLayer(opts = {}) {
  const config = {
    enabled: opts.enabled ?? false,
    probPerCycle: clamp(opts.probPerCycle ?? 0, 0, 1),
    intensity: clamp(opts.intensity ?? 0.6, 0, 1),
    glitch: {
      maxCellsPerBlend: clampInt(opts.maxCellsPerBlend ?? 2, 1, 12, 2),
      subdiv: clampInt(opts.subdiv ?? 2, 1, 2, 2),
      spillStrength: clamp(opts.spillStrength ?? 0.45, 0.05, 1),
    },
  };

  const planCache = new Map();

  function buildPlanForCycle(cycleIndex, renderInfo) {
    const cacheKey = String(cycleIndex);
    const cached = planCache.get(cacheKey);
    if (Array.isArray(cached)) return cached;
    const plan = buildTransitionPlan({ cycleIndex }, renderInfo, config.intensity, config.glitch);
    planCache.set(cacheKey, plan);
    return plan;
  }

  function drawPlan(ctx, plan, renderInfo, pixels) {
    const rasterX = renderInfo.offsetX;
    const rasterY = renderInfo.offsetY;
    const rasterW = renderInfo.baseWidth * renderInfo.pixelSize;
    const rasterH = renderInfo.baseHeight * renderInfo.pixelSize;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rasterX, rasterY, rasterW, rasterH);
    ctx.clip();
    for (const rect of plan) {
      const srcX = clamp(rect.srcX, 0, renderInfo.baseWidth - 1);
      const srcY = clamp(rect.srcY, 0, renderInfo.baseHeight - 1);
      const [r, g, b] = colorAtCell(pixels, renderInfo.baseWidth, srcX, srcY);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const left = Math.round(rasterX + rect.x * renderInfo.pixelSize);
      const top = Math.round(rasterY + rect.y * renderInfo.pixelSize);
      const right = Math.round(rasterX + (rect.x + rect.w) * renderInfo.pixelSize);
      const bottom = Math.round(rasterY + (rect.y + rect.h) * renderInfo.pixelSize);
      ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
    ctx.restore();
  }

  return {
    shouldTrigger() {
      if (!config.enabled || config.probPerCycle <= 0) return false;
      return Math.random() < config.probPerCycle;
    },
    renderCyclePlan(ctx, renderInfo, pixels, cycleIndex) {
      drawPlan(ctx, buildPlanForCycle(cycleIndex, renderInfo), renderInfo, pixels);
    },
  };
}
