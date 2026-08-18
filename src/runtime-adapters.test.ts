import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeAdapter, detectRuntimes } from "./runtime-adapters";

const servers: ReturnType<typeof createServer>[] = [];

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe("runtime adapters", () => {
  it("discovers Ollama models and uses its native nanosecond timings", async () => {
    const baseUrl = await fixture((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/version") return response.end(JSON.stringify({ version: "0.11.4" }));
      if (request.url === "/api/tags") return response.end(JSON.stringify({ models: [{ name: "qwen3:8b", size: 5_000_000_000, details: { parameter_size: "8B", quantization_level: "Q4_K_M" } }] }));
      if (request.url === "/api/generate") return response.end(JSON.stringify({ prompt_eval_count: 24, prompt_eval_duration: 24_000_000, eval_count: 64, eval_duration: 2_000_000_000, load_duration: 10_000_000, total_duration: 2_034_000_000 }));
      response.statusCode = 404;
      response.end("{}");
    });
    const [candidate] = await detectRuntimes({ key: "ollama", baseUrl });
    expect(candidate).toMatchObject({ runtime: "Ollama", version: "0.11.4" });
    expect(candidate?.models[0]).toMatchObject({ id: "qwen3:8b", catalogueSlug: "qwen3-8b", quantization: "Q4_K_M" });
    const metrics = await createRuntimeAdapter(candidate!).benchmark({ model: "qwen3:8b", context: 8192, maxTokens: 64 });
    expect(metrics).toMatchObject({ generatedTokens: 64, generationTps: 32, promptTps: 1000, metricSource: "runtime", generationDurationMs: 2000 });
  });

  it("discovers vLLM and consumes OpenAI-compatible streaming usage", async () => {
    const baseUrl = await fixture((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "Qwen/Qwen3-8B", owned_by: "vllm" }] }));
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        let raw = "";
        request.on("data", (chunk) => { raw += chunk.toString(); });
        request.on("end", () => {
          const body = JSON.parse(raw) as { stream?: boolean };
          if (!body.stream) return response.end(JSON.stringify({ choices: [{ message: { content: "warm" } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }));
          response.setHeader("content-type", "text/event-stream");
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Measured" } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 24, completion_tokens: 20 }, timings: { prompt_per_second: 800, predicted_per_second: 40 } })}\n\n`);
          response.end("data: [DONE]\n\n");
        });
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    const [candidate] = await detectRuntimes({ key: "vllm", baseUrl });
    expect(candidate).toMatchObject({ runtime: "vLLM" });
    const metrics = await createRuntimeAdapter(candidate!).benchmark({ model: "Qwen/Qwen3-8B", context: 8192, maxTokens: 20 });
    expect(metrics).toMatchObject({ promptTokens: 24, generatedTokens: 20, promptTps: 800, generationTps: 40, metricSource: "runtime", generationDurationMs: 500 });
  });
});
