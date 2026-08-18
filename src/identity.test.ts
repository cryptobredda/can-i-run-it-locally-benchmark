import { describe, expect, it } from "vitest";
import type { HardwareSpec } from "./protocol";
import { hardwareIdentity } from "./identity";

const hardware: HardwareSpec = {
  gpuVendor: "NVIDIA",
  gpuName: "NVIDIA GeForce RTX 4090",
  vramGb: 24,
  systemRamGb: 64,
  unifiedMemory: false,
  cpuCores: 32,
  cpuModel: "AMD Ryzen 9 7950X",
  operatingSystem: "Windows_NT",
  architecture: "x64",
  storageFreeGb: 123,
  runtime: "Ollama",
  workload: "Everyday chat",
  contextTarget: 8192
};

describe("hardwareIdentity", () => {
  it("is stable across mutable benchmark preferences", () => {
    const first = hardwareIdentity(hardware);
    const second = hardwareIdentity({ ...hardware, runtime: "vLLM", contextTarget: 32768, storageFreeGb: 42 });
    expect(second).toEqual(first);
    expect(first.publicRigId).toMatch(/^RIG-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });

  it("changes when the hardware configuration changes", () => {
    expect(hardwareIdentity({ ...hardware, vramGb: 16 }).fingerprint).not.toBe(hardwareIdentity(hardware).fingerprint);
  });
});
