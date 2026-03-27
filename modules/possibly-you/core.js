import { defaultConfig } from "./config.default.js";

function createRandomFrame(width, height) {
  const frame = new Uint8Array(width * height * 3);
  for (let i = 0; i < frame.length; i += 1) {
    frame[i] = Math.floor(Math.random() * 256);
  }
  return frame;
}

function blendFrames(currentFrame, nextFrame, t) {
  const blended = new Uint8Array(currentFrame.length);
  for (let i = 0; i < blended.length; i += 1) {
    blended[i] = Math.floor(currentFrame[i] * (1 - t) + nextFrame[i] * t);
  }
  return blended;
}

export function createEngine(config = {}) {
  const baseWidth = config.baseWidth ?? defaultConfig.baseWidth;
  const baseHeight = config.baseHeight ?? defaultConfig.baseHeight;
  const transitionMs = config.transitionMs ?? defaultConfig.transitionMs;
  const holdMs = config.holdMs ?? defaultConfig.holdMs;
  const errorLayer = config.errorLayer ?? { shouldTrigger: () => false };
  const nextFrameGenerator = config.nextFrameGenerator;

  function createRandomBaseFrame() {
    return createRandomFrame(baseWidth, baseHeight);
  }

  function createNextFrame(meta) {
    const randomFrame = createRandomBaseFrame();
    const errorActive = errorLayer.shouldTrigger(meta);
    if (typeof nextFrameGenerator !== "function") {
      return { frame: randomFrame, portraitActive: false, errorActive };
    }

    const candidate = nextFrameGenerator({
      randomFrame,
      randomFrameFactory: createRandomBaseFrame,
      ...meta,
    });

    if (candidate instanceof Uint8Array && candidate.length === randomFrame.length) {
      return { frame: candidate, portraitActive: false, errorActive };
    }

    if (candidate && typeof candidate === "object") {
      const candidateFrame = candidate.frame ?? candidate.pixels;
      if (candidateFrame instanceof Uint8Array && candidateFrame.length === randomFrame.length) {
        return {
          frame: candidateFrame,
          portraitActive: Boolean(candidate.portraitActive),
          errorActive,
        };
      }
    }

    return { frame: randomFrame, portraitActive: false, errorActive };
  }

  let currentFrame = createRandomBaseFrame();
  let frameCurrentIndex = 0;
  let frameNextIndex = 1;
  let nextFrameResult = createNextFrame({ cycleIndex: frameNextIndex, isInitial: true, timestamp: 0 });
  let nextFrame = nextFrameResult.frame;
  let cycleStart = null;

  function advanceCycle(timestamp) {
    currentFrame = nextFrame;
    frameCurrentIndex = frameNextIndex;
    frameNextIndex = frameCurrentIndex + 1;
    nextFrameResult = createNextFrame({ cycleIndex: frameNextIndex, isInitial: false, timestamp });
    nextFrame = nextFrameResult.frame;
    cycleStart = timestamp;
  }

  function getFrameAt(timestamp) {
    if (cycleStart === null) cycleStart = timestamp;

    const cycleDuration = transitionMs + holdMs;
    let elapsed = timestamp - cycleStart;

    while (elapsed >= cycleDuration) {
      advanceCycle(timestamp);
      elapsed = timestamp - cycleStart;
    }

    if (elapsed < transitionMs) {
      const t = elapsed / transitionMs;
      return {
        pixels: blendFrames(currentFrame, nextFrame, t),
        meta: {
          phase: "blend",
          transitionT: t,
          glitchCurrentCycleIndex: frameCurrentIndex,
          glitchNextCycleIndex: frameNextIndex,
          glitchCurrentActive: Boolean(nextFrameResult.errorActive),
          glitchNextActive: Boolean(nextFrameResult.errorActive),
          portraitActive: Boolean(nextFrameResult.portraitActive),
        },
      };
    }

    return {
      pixels: nextFrame,
      meta: {
        phase: "hold",
        transitionT: 1,
        glitchCurrentCycleIndex: frameNextIndex,
        glitchNextCycleIndex: frameNextIndex,
        glitchCurrentActive: Boolean(nextFrameResult.errorActive),
        glitchNextActive: Boolean(nextFrameResult.errorActive),
        portraitActive: Boolean(nextFrameResult.portraitActive),
      },
    };
  }

  return {
    baseWidth,
    baseHeight,
    getFrameAt,
  };
}
