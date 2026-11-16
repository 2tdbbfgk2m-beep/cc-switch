import levels from "./reasoningLevels.json";
// Candidate values, not a declaration that every model supports them.
export const REASONING_LEVELS: readonly string[] = levels;

export const API_REASONING_LEVELS = REASONING_LEVELS.filter(
  (level) => level !== "ultra",
);
