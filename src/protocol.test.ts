import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { benchmarkUploadV2Schema, type BenchmarkUploadV2 } from "./protocol";
import { hardwareIdentity } from "./identity";

const hardware = {
  gpuVendor: "NVIDIA" as const,
  gpuName: "RTX 4070 Super",
  vramGb: 12,
  systemRamGb: 32,
  unifiedMemory: false,
  cpuCores: 16,
  cpuModel: "Test CPU",
  operatingSystem: "Linux",
  architecture: "x64",
  storageFreeGb: 100,
  runtime: "Ollama" as const,
  workload: "Everyday chat" as const,
  contextTarget: 8192
};

function upload(): BenchmarkUploadV2 {
  const identity = hardwareIdentity(hardware);
  return {
    schemaVersion: 2,
    consent: true,
    clientVersion: "0.2.0",
    hardwareFingerprint: identity.fingerprint,
    publicRigId: identity.publicRigId,
    clientRunId: randomUUID(),
    benchmarkProtocol: "ciritl-quick-v1",
    hardware,
    modelSlug: "qwen3-8b",
    modelTag: "qwen3:8b",
    quantization: "Q4_K_M",
    context: 8192,
    promptTokens: 80,
    generatedTokens: 128,
    promptTps: 900,
    generationTps: 64,
    durationMs: 2300,
    runtimeVersion: "test-runtime",
    metricSource: "runtime",
    endToEndMs: 2300,
    generationDurationMs: 2000
  };
}

describe("schema-v2 contribution", () => {
  it("accepts a complete public benchmark payload", () => {
    expect(benchmarkUploadV2Schema.parse(upload())).toMatchObject({ schemaVersion: 2, consent: true, benchmarkProtocol: "ciritl-quick-v1" });
  });

  it("rejects consent or identity formatting changes", () => {
    expect(benchmarkUploadV2Schema.safeParse({ ...upload(), consent: false }).success).toBe(false);
    expect(benchmarkUploadV2Schema.safeParse({ ...upload(), publicRigId: "RIG-INVALID" }).success).toBe(false);
  });

  it("contains no account, hostname, serial or filesystem field", () => {
    const serialized = JSON.stringify(upload()).toLowerCase();
    for (const forbidden of ["email", "username", "hostname", "serialnumber", "macaddress", "filelist"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });
});
