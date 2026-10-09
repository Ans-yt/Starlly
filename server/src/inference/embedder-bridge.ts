// Bridge so eval.ts stays pure: re-exports the tagging math plus the EmbedFn
// type from embedder without pulling DB code into eval runs.
export { classifySentiment, SENTIMENT_ANCHORS, tagThemes, themeText } from "./tagging.js";
export type { EmbedFn } from "./embedder.js";
