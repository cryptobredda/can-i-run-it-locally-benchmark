import { z } from "zod";

export type GpuVendor = "NVIDIA" | "AMD" | "Apple" | "Intel" | "CPU only";
export type Runtime = "Ollama" | "llama.cpp" | "LM Studio" | "MLX" | "vLLM" | "LocalAI" | "OpenAI-compatible";
export type Workload = "Everyday chat" | "Coding" | "Reasoning" | "Vision" | "Embedding";

export interface HardwareSpec {
  gpuVendor: GpuVendor;
  gpuName: string;
  vramGb: number;
  systemRamGb: number;
  unifiedMemory: boolean;
  cpuCores: number;
  cpuModel?: string | undefined;
  operatingSystem?: string | undefined;
  architecture?: string | undefined;
  storageFreeGb: number;
  runtime: Runtime;
  workload: Workload;
  contextTarget: number;
}

export const runtimeSchema = z.enum(["Ollama", "llama.cpp", "LM Studio", "MLX", "vLLM", "LocalAI", "OpenAI-compatible"]);

export const hardwareSpecSchema = z.object({
  gpuVendor: z.enum(["NVIDIA", "AMD", "Apple", "Intel", "CPU only"]),
  gpuName: z.string().trim().min(1).max(120),
  vramGb: z.number().min(0).max(256),
  systemRamGb: z.number().min(4).max(2048),
  unifiedMemory: z.boolean(),
  cpuCores: z.number().int().min(1).max(512),
  cpuModel: z.string().trim().min(1).max(160).optional(),
  operatingSystem: z.string().trim().min(1).max(40).optional(),
  architecture: z.string().trim().min(1).max(40).optional(),
  storageFreeGb: z.number().min(1).max(100_000),
  runtime: runtimeSchema,
  workload: z.enum(["Everyday chat", "Coding", "Reasoning", "Vision", "Embedding"]),
  contextTarget: z.number().int().min(2_048).max(1_048_576)
});

export const benchmarkUploadV2Schema = z.object({
  schemaVersion: z.literal(2),
  consent: z.literal(true),
  clientVersion: z.string().min(1).max(32),
  hardwareFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  publicRigId: z.string().regex(/^RIG-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/),
  clientRunId: z.string().uuid(),
  benchmarkProtocol: z.literal("ciritl-quick-v1"),
  hardware: hardwareSpecSchema,
  modelSlug: z.string().min(1).max(120).nullable(),
  modelTag: z.string().min(1).max(180),
  quantization: z.string().min(1).max(40),
  context: z.number().int().min(512).max(1_048_576),
  promptTokens: z.number().int().min(0).max(10_000_000),
  generatedTokens: z.number().int().min(1).max(100_000),
  promptTps: z.number().min(0).max(1_000_000),
  generationTps: z.number().min(0.01).max(100_000),
  durationMs: z.number().int().min(1).max(86_400_000),
  backendVersion: z.string().max(80).optional(),
  runtimeVersion: z.string().min(1).max(80),
  metricSource: z.enum(["runtime", "client", "estimated"]),
  timeToFirstTokenMs: z.number().min(0).max(3_600_000).optional(),
  endToEndMs: z.number().int().min(1).max(86_400_000),
  generationDurationMs: z.number().int().min(1).max(86_400_000),
  loadTimeMs: z.number().min(0).max(86_400_000).optional(),
  probe: z.object({
    memoryBandwidthGbps: z.number().min(0).max(10_000).optional(),
    cpuScore: z.number().min(0).max(1_000_000).optional()
  }).optional(),
  systemMetrics: z.object({
    systemMemoryUsedGb: z.number().min(0).max(2_048).optional(),
    gpuMemoryUsedGb: z.number().min(0).max(256).optional(),
    gpuUtilizationPercent: z.number().min(0).max(100).optional(),
    gpuTemperatureC: z.number().min(-20).max(150).optional(),
    gpuPowerWatts: z.number().min(0).max(2_000).optional()
  }).optional()
});

export type BenchmarkUploadV2 = z.infer<typeof benchmarkUploadV2Schema>;

function normalized(value: string | undefined) {
  return (value ?? "unknown").trim().replace(/\s+/g, " ").toLowerCase();
}

export function canonicalHardwareIdentity(hardware: HardwareSpec) {
  return JSON.stringify({
    architecture: normalized(hardware.architecture),
    cpuCores: hardware.cpuCores,
    cpuModel: normalized(hardware.cpuModel),
    gpuName: normalized(hardware.gpuName),
    gpuVendor: hardware.gpuVendor,
    operatingSystem: normalized(hardware.operatingSystem),
    systemRamGb: Math.round(hardware.systemRamGb),
    unifiedMemory: hardware.unifiedMemory,
    vramGb: Math.round(hardware.vramGb * 10) / 10
  });
}

export function publicRigIdFromFingerprint(fingerprint: string) {
  const value = fingerprint.replace(/[^a-f0-9]/gi, "").toUpperCase().padEnd(16, "0");
  return `RIG-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
}
