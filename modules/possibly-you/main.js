import { createEngine } from "./core.js";
import { defaultConfig } from "./config.default.js";
import { createErrorLayer } from "./error_layer.js";

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isModeEnabled(mode, feature) {
  if (mode === "both") return true;
  if (feature === "glitch") return mode === "glitch";
  if (feature === "portrait") return mode === "portrait";
  return false;
}

function mixWithTargetFrame(randomFrame, targetFrame, pixelKeepProb) {
  const mixed = new Uint8Array(randomFrame);
  for (let i = 0; i < mixed.length; i += 3) {
    if (Math.random() < pixelKeepProb) {
      mixed[i] = targetFrame[i];
      mixed[i + 1] = targetFrame[i + 1];
      mixed[i + 2] = targetFrame[i + 2];
    }
  }
  return mixed;
}

function downsamplePortraitToTargetFrame(image) {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = defaultConfig.baseWidth;
  sampleCanvas.height = defaultConfig.baseHeight;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleCtx.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const imageData = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const target = new Uint8Array(sampleCanvas.width * sampleCanvas.height * 3);

  for (let i = 0, j = 0; i < imageData.length; i += 4, j += 3) {
    target[j] = imageData[i];
    target[j + 1] = imageData[i + 1];
    target[j + 2] = imageData[i + 2];
  }

  return target;
}

function loadPortraitFromUrl(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        resolve(downsamplePortraitToTargetFrame(image));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error(`Portrait could not be loaded: ${url}`));
    image.src = url;
  });
}

function getQueryOptions() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: (params.get("mode") || "normal").toLowerCase(),
    portraitUrls: params.getAll("portrait").filter(Boolean),
  };
}

function mount(el, options = {}) {
  const container = el instanceof Element ? el : document.body;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.imageRendering = "pixelated";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const queryOptions = getQueryOptions();
  const mode = (options.mode || queryOptions.mode || "normal").toLowerCase();
  const portraitUrls = Array.isArray(options.portraitUrls) && options.portraitUrls.length > 0
    ? options.portraitUrls
    : queryOptions.portraitUrls;
  const portraitEnabled = isModeEnabled(mode, "portrait");
  const glitchEnabled = isModeEnabled(mode, "glitch");
  const portraitFrames = [];

  const errorLayer = createErrorLayer({
    enabled: glitchEnabled,
    probPerCycle: glitchEnabled ? 0.08 : 0,
    intensity: 0.65,
    maxCellsPerBlend: defaultConfig.error.glitch.maxCellsPerBlend,
    subdiv: defaultConfig.error.glitch.subdiv,
    spillStrength: defaultConfig.error.glitch.spillStrength,
  });

  function nextFrameGenerator({ randomFrame, isInitial }) {
    if (isInitial || !portraitEnabled || portraitFrames.length === 0) {
      return { frame: randomFrame, portraitActive: false };
    }
    if (Math.random() >= defaultConfig.portrait.probPerCycle) {
      return { frame: randomFrame, portraitActive: false };
    }
    const targetFrame = portraitFrames[Math.floor(Math.random() * portraitFrames.length)];
    if (!(targetFrame instanceof Uint8Array)) {
      return { frame: randomFrame, portraitActive: false };
    }
    return {
      frame: mixWithTargetFrame(randomFrame, targetFrame, clamp01(defaultConfig.portrait.pixelKeepProb)),
      portraitActive: true,
    };
  }

  const engine = createEngine({
    baseWidth: defaultConfig.baseWidth,
    baseHeight: defaultConfig.baseHeight,
    transitionMs: defaultConfig.transitionMs,
    holdMs: defaultConfig.holdMs,
    errorLayer,
    nextFrameGenerator,
  });

  function getRenderInfo(pixels) {
    const width = Math.max(1, Math.floor(container.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.floor(container.clientHeight || window.innerHeight));
    canvas.width = width;
    canvas.height = height;
    const pixelSize = Math.max(1, Math.ceil(Math.max(width / engine.baseWidth, height / engine.baseHeight)));
    const offsetX = Math.floor((width - engine.baseWidth * pixelSize) / 2);
    const offsetY = Math.floor((height - engine.baseHeight * pixelSize) / 2);
    return {
      width,
      height,
      baseWidth: engine.baseWidth,
      baseHeight: engine.baseHeight,
      pixelSize,
      offsetX,
      offsetY,
      pixels,
    };
  }

  function drawPixels(renderInfo, pixels) {
    ctx.clearRect(0, 0, renderInfo.width, renderInfo.height);
    for (let y = 0; y < renderInfo.baseHeight; y += 1) {
      for (let x = 0; x < renderInfo.baseWidth; x += 1) {
        const i = (y * renderInfo.baseWidth + x) * 3;
        ctx.fillStyle = `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`;
        ctx.fillRect(
          renderInfo.offsetX + x * renderInfo.pixelSize,
          renderInfo.offsetY + y * renderInfo.pixelSize,
          renderInfo.pixelSize,
          renderInfo.pixelSize,
        );
      }
    }
  }

  let rafId = 0;
  function draw(timestamp) {
    const frame = engine.getFrameAt(timestamp);
    const renderInfo = getRenderInfo(frame.pixels);
    drawPixels(renderInfo, frame.pixels);
    const glitchActive = frame.meta.phase === "blend"
      ? frame.meta.glitchCurrentActive || frame.meta.glitchNextActive
      : frame.meta.glitchCurrentActive;
    if (glitchEnabled && glitchActive) {
      const cycleIndex = frame.meta.phase === "blend" ? frame.meta.glitchNextCycleIndex : frame.meta.glitchCurrentCycleIndex;
      errorLayer.renderCyclePlan(ctx, renderInfo, frame.pixels, cycleIndex);
    }
    rafId = window.requestAnimationFrame(draw);
  }

  Promise.all(portraitUrls.map((url) => loadPortraitFromUrl(url)))
    .then((frames) => {
      frames.forEach((frame) => {
        if (frame instanceof Uint8Array) portraitFrames.push(frame);
      });
    })
    .finally(() => {
      rafId = window.requestAnimationFrame(draw);
    });

  return {
    destroy() {
      window.cancelAnimationFrame(rafId);
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
    },
  };
}

window.PossiblyYou = { mount };

mount(document.getElementById("app"));
