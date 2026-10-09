// Tiny OpenAI-compatible stub for e2e tests. Serves POST /v1/chat/completions
// with a one-choice body, so the real openAiAdapter's "Test connection"
// (a one-token chat completion) passes honestly over real HTTP.
const http = require("node:http");

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url && req.url.includes("/chat/completions")) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-e2e-stub",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        }),
      );
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

const port = Number(process.env.STUB_PORT || 8791);
server.listen(port, "127.0.0.1", () => {
  console.log(`[ai-stub] listening on ${port}`);
});