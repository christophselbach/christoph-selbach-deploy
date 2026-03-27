export const defaultConfig = {
  baseWidth: 10,
  baseHeight: 10,
  transitionMs: 1000,
  holdMs: 4000,
  error: {
    probPerCycle: 0,
    intensity: 0.65,
    glitch: {
      maxCellsPerBlend: 2,
      subdiv: 2,
      spillStrength: 0.45,
    },
  },
  portrait: {
    probPerCycle: 0.02,
    pixelKeepProb: 0.18,
  },
};
