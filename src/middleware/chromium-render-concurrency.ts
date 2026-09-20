import { createConcurrencyLimiter } from "./concurrency-limit.js";

/** Shared authority for every server-generated Chromium PDF render. */
export const chromiumRenderConcurrencyLimiter = createConcurrencyLimiter({
  maxConcurrent: 4,
  message: "The Chromium PDF renderer is busy. Try again shortly.",
  errorCode: "CHROMIUM_RENDER_BUSY",
});
