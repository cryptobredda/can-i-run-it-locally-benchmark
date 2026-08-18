import type { Runtime } from "./protocol";

export type RuntimeKey = "ollama" | "lm-studio" | "vllm" | "llama.cpp" | "mlx" | "localai" | "openai-compatible";

export interface DetectedModel {
  id: string;
  name: string;
  quantization: string;
  parameterSize?: string;
  sizeBytes?: number;
  contextLength?: number;
  catalogueSlug?: string;
}

export interface RuntimeCandidate {
  key: RuntimeKey;
  runtime: Runtime;
  label: string;
  baseUrl: string;
  version: string;
  models: DetectedModel[];
  detail: string;
}

export interface BenchmarkOptions { model: string; context: number; maxTokens: number }

export interface BenchmarkMetrics {
  promptTokens: number;
  generatedTokens: number;
  promptTps: number;
  generationTps: number;
  durationMs: number;
  endToEndMs: number;
  generationDurationMs: number;
  metricSource: "runtime" | "client" | "estimated";
  timeToFirstTokenMs?: number;
  loadTimeMs?: number;
}

export interface RuntimeAdapter {
  candidate: RuntimeCandidate;
  benchmark(options: BenchmarkOptions): Promise<BenchmarkMetrics>;
}
