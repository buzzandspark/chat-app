// A stand-in for the Anthropic API that costs nothing: point ANTHROPIC_BASE_URL at it to try spend limits.
// Chat replies stream the Haiku `normal` scenario; Explore calls (output_config.format) get a JSON options answer. Run it with tsx.
import http from "node:http";
import { scriptToLines } from "../src/relay/providers/scripted.ts";
import { scenarioScript } from "../src/relay/scenarios.ts";

const port = Number(process.env.MOCK_PORT ?? 4010);
const host = process.env.MOCK_HOST ?? "127.0.0.1";
const inputTokens = optionalInt("MOCK_INPUT_TOKENS");
const outputTokens = optionalInt("MOCK_OUTPUT_TOKENS");
const delayMs = optionalInt("MOCK_DELAY_MS") ?? 0;
const truncated = process.env.MOCK_OPTIONS === "truncated";

const reply = scriptToLines(scenarioScript("normal", { model: "claude-haiku-5-5", thinking: { effort: "low" }, messages: [] }))
  .flatMap((line) => ("event" in line ? [line.event] : []));

const OPTIONS = [
  { title: "Resume by sequence", prompt: "Let's go with resuming by sequence number: what does the client store per generation?" },
  { title: "Replay from the database", prompt: "Let's explore replaying from the database: how often should partial rows be saved?" },
  { title: "Restart the reply", prompt: "Let's look at restarting the reply: what does it cost and when is it acceptable?" },
];

function optionalInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function chatEvents(model) {
  return reply.map((event) => {
    const copy = structuredClone(event);
    if (copy.type === "message_start") {
      copy.message.model = model;
      if (inputTokens !== undefined) copy.message.usage.input_tokens = inputTokens;
    }
    if (copy.type === "message_delta") {
      for (const usage of [copy.usage, ...(copy.usage.iterations ?? [])]) {
        usage.model &&= model;
        if (inputTokens !== undefined) usage.input_tokens = inputTokens;
        if (outputTokens !== undefined) usage.output_tokens = outputTokens;
      }
    }
    return copy;
  });
}

function optionsEvents(body) {
  const content = String(body.messages?.[0]?.content ?? "");
  const rewrite = /<instruction>\n([\s\S]*?)\n<\/instruction>\n<prompts>\n([\s\S]*)\n<\/prompts>/.exec(content);
  const answer = rewrite
    ? { options: JSON.parse(rewrite[2]).map((o) => ({ title: o.title, prompt: `${rewrite[1].trim()} ${o.prompt}` })) }
    : { count: OPTIONS.length, options: OPTIONS };
  const json = JSON.stringify(answer);
  const text = truncated ? json.slice(0, Math.floor(json.length * 0.6)) : json;
  const input = inputTokens ?? 800;
  const output = outputTokens ?? (truncated ? body.max_tokens : Math.ceil(text.length / 2.5));
  const deltas = [];
  for (let i = 0; i < text.length; i += 24) {
    deltas.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 24) } });
  }
  return [
    {
      type: "message_start",
      message: { id: `msg_mock_${Date.now()}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...deltas,
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: truncated ? "max_tokens" : "end_turn", stop_sequence: null },
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    { type: "message_stop" },
  ];
}

function apiError(res, status, type, message) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type, message } }));
}

async function stream(res, events) {
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": `req_mock_${Date.now()}` });
  for (const event of events) {
    if (closed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://mock").pathname;
  const count = path === "/v1/messages/count_tokens";
  if (req.method !== "POST" || (path !== "/v1/messages" && !count)) return apiError(res, 404, "not_found_error", `${req.method} ${path} is not mocked`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return apiError(res, 400, "invalid_request_error", "body is not JSON");
  }
  if (count) {
    const tokens = inputTokens ?? Math.ceil(Buffer.byteLength(JSON.stringify([body.system, body.messages])) / 2.5);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ input_tokens: tokens }));
  }
  if (!body.stream) return apiError(res, 400, "invalid_request_error", "the mock answers streaming requests only");
  const options = body.output_config?.format !== undefined;
  console.log(`[mock] ${body.model} ${options ? (truncated ? "options (truncated)" : "options") : "chat"} max_tokens: ${body.max_tokens}`);
  await stream(res, options ? optionsEvents(body) : chatEvents(body.model));
});

server.listen(port, host, () => {
  console.log(`[mock] Anthropic API on http://${host}:${port} (delay ${delayMs} ms per event)`);
});
