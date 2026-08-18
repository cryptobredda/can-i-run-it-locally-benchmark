import { performance } from "node:perf_hooks";
import type { Runtime } from "./protocol";
import { matchCatalogueModel } from "./model-match";
import { processInventory } from "./probe";
import type { BenchmarkMetrics, BenchmarkOptions, DetectedModel, RuntimeAdapter, RuntimeCandidate, RuntimeKey } from "./types";

const BENCHMARK_PROMPT = "Explain in three concise paragraphs why memory bandwidth matters for local language-model inference.";

function cleanUrl(value: string) { return value.replace(/\/+$/, ""); }

async function fetchWithTimeout(url: string, init?: RequestInit, timeout = 3_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}

function modelRecord(id: string, detail?: Partial<DetectedModel>): DetectedModel {
  const matched = matchCatalogueModel(id);
  return {
    id,
    name: detail?.name ?? id,
    quantization: detail?.quantization ?? "unknown",
    ...(detail?.parameterSize ? { parameterSize: detail.parameterSize } : {}),
    ...(detail?.sizeBytes !== undefined ? { sizeBytes: detail.sizeBytes } : {}),
    ...(detail?.contextLength !== undefined ? { contextLength: detail.contextLength } : {}),
    ...(matched ? { catalogueSlug: matched.slug } : {})
  };
}

interface OllamaTags {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: { parameter_size?: string; quantization_level?: string };
  }>;
}

async function probeOllama(baseUrl: string): Promise<RuntimeCandidate | undefined> {
  try {
    const [versionResponse, modelsResponse] = await Promise.all([
      fetchWithTimeout(`${baseUrl}/api/version`),
      fetchWithTimeout(`${baseUrl}/api/tags`)
    ]);
    if (!versionResponse.ok || !modelsResponse.ok) return undefined;
    const version = await versionResponse.json() as { version?: string };
    const tags = await modelsResponse.json() as OllamaTags;
    const found = (tags.models ?? []).flatMap((entry) => {
      const id = entry.name ?? entry.model;
      return id ? [modelRecord(id, {
        quantization: entry.details?.quantization_level ?? "unknown",
        ...(entry.size !== undefined ? { sizeBytes: entry.size } : {}),
        ...(entry.details?.parameter_size ? { parameterSize: entry.details.parameter_size } : {})
      })] : [];
    });
    return {
      key: "ollama",
      runtime: "Ollama",
      label: "Ollama",
      baseUrl,
      version: version.version ?? "unknown",
      models: found,
      detail: `${found.length} local model${found.length === 1 ? "" : "s"}`
    };
  } catch {
    return undefined;
  }
}

interface OpenAIModelList {
  data?: Array<{ id?: string; owned_by?: string; meta?: { context_length?: number } }>;
}

function identifyOpenAIRuntime(baseUrl: string, body: OpenAIModelList, inventory: string, forced?: RuntimeKey) {
  if (forced) return forced;
  if (baseUrl.endsWith(":1234") || /lm studio|lm-studio|lms\.exe/.test(inventory)) return "lm-studio";
  if (baseUrl.endsWith(":8000") || /vllm/.test(inventory) || body.data?.some((model) => /vllm/i.test(model.owned_by ?? ""))) return "vllm";
  if (/llama-server|llama\.cpp/.test(inventory) || body.data?.some((model) => /llamacpp|llama\.cpp/i.test(model.owned_by ?? ""))) return "llama.cpp";
  if (/mlx[_-]lm|mlx-lm/.test(inventory) || body.data?.some((model) => /mlx/i.test(model.owned_by ?? ""))) return "mlx";
  if (/local-ai|localai/.test(inventory) || body.data?.some((model) => /localai/i.test(model.owned_by ?? ""))) return "localai";
  return "openai-compatible";
}

function runtimeMetadata(key: RuntimeKey): { runtime: Runtime; label: string } {
  switch (key) {
    case "lm-studio": return { runtime: "LM Studio", label: "LM Studio" };
    case "vllm": return { runtime: "vLLM", label: "vLLM" };
    case "llama.cpp": return { runtime: "llama.cpp", label: "llama.cpp server" };
    case "mlx": return { runtime: "MLX", label: "MLX-LM server" };
    case "localai": return { runtime: "LocalAI", label: "LocalAI" };
    default: return { runtime: "OpenAI-compatible", label: "OpenAI-compatible server" };
  }
}

async function probeLmStudioNative(baseUrl: string) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/api/v1/models`);
    if (!response.ok) return [];
    const body = await response.json() as { models?: Array<{ key?: string; id?: string; display_name?: string; quantization?: string; max_context_length?: number }> } | Array<{ key?: string; id?: string; display_name?: string; quantization?: string; max_context_length?: number }>;
    const entries = Array.isArray(body) ? body : body.models ?? [];
    return entries.flatMap((entry) => {
      const id = entry.key ?? entry.id;
      return id ? [modelRecord(id, {
        name: entry.display_name ?? id,
        quantization: entry.quantization ?? "unknown",
        ...(entry.max_context_length !== undefined ? { contextLength: entry.max_context_length } : {})
      })] : [];
    });
  } catch {
    return [];
  }
}

async function probeOpenAI(baseUrl: string, inventory: string, forced?: RuntimeKey): Promise<RuntimeCandidate | undefined> {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/v1/models`);
    if (!response.ok) return undefined;
    const body = await response.json() as OpenAIModelList;
    const key = identifyOpenAIRuntime(baseUrl, body, inventory, forced);
    const metadata = runtimeMetadata(key);
    let found = (body.data ?? []).flatMap((entry) => entry.id ? [modelRecord(entry.id, {
      ...(entry.meta?.context_length !== undefined ? { contextLength: entry.meta.context_length } : {})
    })] : []);
    if (key === "lm-studio") {
      const nativeModels = await probeLmStudioNative(baseUrl);
      if (nativeModels.length) found = nativeModels;
    }
    const server = response.headers.get("server") ?? response.headers.get("x-powered-by");
    return {
      key,
      ...metadata,
      baseUrl,
      version: server?.slice(0, 80) || "unknown",
      models: found,
      detail: `${found.length} served model${found.length === 1 ? "" : "s"}`
    };
  } catch {
    return undefined;
  }
}

const DEFAULT_ENDPOINTS: Array<{ baseUrl: string; kind: "ollama" | "openai"; forced?: RuntimeKey }> = [
  { baseUrl: "http://127.0.0.1:11434", kind: "ollama" },
  { baseUrl: "http://127.0.0.1:1234", kind: "openai", forced: "lm-studio" },
  { baseUrl: "http://127.0.0.1:8000", kind: "openai", forced: "vllm" },
  { baseUrl: "http://127.0.0.1:8080", kind: "openai" }
];

export async function detectRuntimes(custom?: { key: RuntimeKey; baseUrl: string }) {
  const inventory = processInventory();
  if (custom) {
    const baseUrl = cleanUrl(custom.baseUrl);
    const candidate = custom.key === "ollama"
      ? await probeOllama(baseUrl)
      : await probeOpenAI(baseUrl, inventory, custom.key);
    return candidate ? [candidate] : [];
  }
  const candidates = await Promise.all(DEFAULT_ENDPOINTS.map((endpoint) => endpoint.kind === "ollama"
    ? probeOllama(endpoint.baseUrl)
    : probeOpenAI(endpoint.baseUrl, inventory, endpoint.forced)));
  return candidates.filter((candidate): candidate is RuntimeCandidate => Boolean(candidate));
}

interface OllamaGenerateResponse {
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  load_duration?: number;
  total_duration?: number;
}

async function ollamaRequest(candidate: RuntimeCandidate, options: BenchmarkOptions, maxTokens: number) {
  const response = await fetchWithTimeout(`${candidate.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt: BENCHMARK_PROMPT,
      stream: false,
      options: { num_predict: maxTokens, num_ctx: options.context, temperature: 0, seed: 42 }
    })
  }, 15 * 60_000);
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json() as Promise<OllamaGenerateResponse>;
}

function ollamaAdapter(candidate: RuntimeCandidate): RuntimeAdapter {
  return {
    candidate,
    async benchmark(options) {
      await ollamaRequest(candidate, options, Math.min(8, options.maxTokens));
      const started = performance.now();
      const body = await ollamaRequest(candidate, options, options.maxTokens);
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      const promptTokens = body.prompt_eval_count ?? 0;
      const generatedTokens = body.eval_count ?? 0;
      const generationDurationMs = Math.max(1, Math.round((body.eval_duration ?? 0) / 1e6));
      const promptDurationSeconds = (body.prompt_eval_duration ?? 0) / 1e9;
      return {
        promptTokens,
        generatedTokens,
        promptTps: promptDurationSeconds > 0 ? promptTokens / promptDurationSeconds : 0,
        generationTps: generatedTokens / (generationDurationMs / 1_000),
        durationMs: elapsed,
        endToEndMs: Math.max(1, Math.round((body.total_duration ?? elapsed * 1e6) / 1e6)),
        generationDurationMs,
        metricSource: "runtime",
        ...((body.load_duration ?? 0) > 0 ? { loadTimeMs: (body.load_duration ?? 0) / 1e6 } : {}),
        ...((body.prompt_eval_duration ?? 0) > 0 ? { timeToFirstTokenMs: ((body.load_duration ?? 0) + (body.prompt_eval_duration ?? 0)) / 1e6 } : {})
      };
    }
  };
}

interface CompletionUsage { prompt_tokens?: number; completion_tokens?: number }
interface NativeTimings { prompt_per_second?: number; predicted_per_second?: number }
interface CompletionBody {
  choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
  usage?: CompletionUsage;
  timings?: NativeTimings;
}

function completionPayload(options: BenchmarkOptions, maxTokens: number, stream: boolean) {
  return {
    model: options.model,
    messages: [{ role: "user", content: BENCHMARK_PROMPT }],
    temperature: 0,
    seed: 42,
    max_tokens: maxTokens,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {})
  };
}

async function openAINonStreaming(candidate: RuntimeCandidate, options: BenchmarkOptions, maxTokens: number) {
  let response = await fetchWithTimeout(`${candidate.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completionPayload(options, maxTokens, false))
  }, 15 * 60_000);
  if (!response.ok) {
    const fallback = completionPayload(options, maxTokens, false);
    delete (fallback as Partial<typeof fallback>).seed;
    response = await fetchWithTimeout(`${candidate.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fallback)
    }, 15 * 60_000);
  }
  if (!response.ok) throw new Error(`${candidate.label} returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json() as Promise<CompletionBody>;
}

async function openAIStreaming(candidate: RuntimeCandidate, options: BenchmarkOptions) {
  const started = performance.now();
  const response = await fetchWithTimeout(`${candidate.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completionPayload(options, options.maxTokens, true))
  }, 15 * 60_000);
  if (!response.ok || !response.body) return undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenAt: number | undefined;
  let usage: CompletionUsage | undefined;
  let timings: NativeTimings | undefined;
  let content = "";

  const consume = (line: string) => {
    const value = line.replace(/^data:\s*/, "").trim();
    if (!value || value === "[DONE]") return;
    try {
      const event = JSON.parse(value) as CompletionBody;
      const piece = event.choices?.[0]?.delta?.content ?? "";
      if (piece && firstTokenAt === undefined) firstTokenAt = performance.now();
      content += piece;
      if (event.usage) usage = event.usage;
      if (event.timings) timings = event.timings;
    } catch { /* ignore non-JSON SSE events */ }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  if (buffer) consume(buffer);
  return { started, ended: performance.now(), firstTokenAt, usage, timings, content };
}

function estimateTokens(text: string) { return Math.max(1, Math.round(text.trim().length / 4)); }

function openAIAdapter(candidate: RuntimeCandidate): RuntimeAdapter {
  return {
    candidate,
    async benchmark(options) {
      await openAINonStreaming(candidate, options, Math.min(8, options.maxTokens));
      const streamed = await openAIStreaming(candidate, options);
      if (!streamed) {
        const started = performance.now();
        const body = await openAINonStreaming(candidate, options, options.maxTokens);
        const elapsed = Math.max(1, Math.round(performance.now() - started));
        const generatedTokens = body.usage?.completion_tokens ?? estimateTokens(body.choices?.[0]?.message?.content ?? "");
        const promptTokens = body.usage?.prompt_tokens ?? estimateTokens(BENCHMARK_PROMPT);
        const nativeTps = body.timings?.predicted_per_second;
        const generationDurationMs = Math.max(1, Math.round(nativeTps ? generatedTokens / nativeTps * 1_000 : elapsed));
        return {
          promptTokens,
          generatedTokens,
          promptTps: body.timings?.prompt_per_second ?? promptTokens / (elapsed / 1_000),
          generationTps: generatedTokens / (generationDurationMs / 1_000),
          durationMs: elapsed,
          endToEndMs: elapsed,
          generationDurationMs,
          metricSource: body.timings?.predicted_per_second ? "runtime" : body.usage ? "client" : "estimated"
        };
      }

      const elapsed = Math.max(1, Math.round(streamed.ended - streamed.started));
      const ttft = streamed.firstTokenAt === undefined ? undefined : Math.max(0, streamed.firstTokenAt - streamed.started);
      const generatedTokens = streamed.usage?.completion_tokens ?? estimateTokens(streamed.content);
      const promptTokens = streamed.usage?.prompt_tokens ?? estimateTokens(BENCHMARK_PROMPT);
      const nativeTps = streamed.timings?.predicted_per_second;
      const measuredGenerationMs = Math.max(1, Math.round(streamed.ended - (streamed.firstTokenAt ?? streamed.started)));
      const generationDurationMs = Math.max(1, Math.round(nativeTps ? generatedTokens / nativeTps * 1_000 : measuredGenerationMs));
      return {
        promptTokens,
        generatedTokens,
        promptTps: streamed.timings?.prompt_per_second ?? (ttft && ttft > 0 ? promptTokens / (ttft / 1_000) : 0),
        generationTps: generatedTokens / (generationDurationMs / 1_000),
        durationMs: elapsed,
        endToEndMs: elapsed,
        generationDurationMs,
        metricSource: streamed.timings?.predicted_per_second ? "runtime" : streamed.usage ? "client" : "estimated",
        ...(ttft !== undefined ? { timeToFirstTokenMs: ttft } : {})
      };
    }
  };
}

export function createRuntimeAdapter(candidate: RuntimeCandidate): RuntimeAdapter {
  return candidate.key === "ollama" ? ollamaAdapter(candidate) : openAIAdapter(candidate);
}

export function parseRuntimeKey(value: string): RuntimeKey | undefined {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, RuntimeKey> = {
    ollama: "ollama",
    lmstudio: "lm-studio",
    "lm-studio": "lm-studio",
    vllm: "vllm",
    llamacpp: "llama.cpp",
    "llama.cpp": "llama.cpp",
    mlx: "mlx",
    "mlx-lm": "mlx",
    localai: "localai",
    "openai-compatible": "openai-compatible",
    openai: "openai-compatible"
  };
  return aliases[normalized];
}
