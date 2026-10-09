// Shared fetch helper for email providers: timeout via AbortController so the
// outbox can distinguish "unknown outcome" (ambiguous) from "request never landed".
export async function providerFetch(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
