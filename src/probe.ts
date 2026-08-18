import { execFileSync } from "node:child_process";
import { arch, cpus, freemem, platform, totalmem, type } from "node:os";
import { performance } from "node:perf_hooks";
import type { GpuVendor, HardwareSpec } from "./protocol";
import { hardwareIdentity } from "./identity";

interface DetectedGpu { vendor: GpuVendor; name: string; vramGb: number; unified: boolean }

function execute(command: string, args: string[], timeout = 5_000) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout, windowsHide: true }).trim();
  } catch {
    return "";
  }
}

function detectGpu(): DetectedGpu {
  const nvidia = execute("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (nvidia) {
    const first = nvidia.split(/\r?\n/)[0] ?? "";
    const [name = "NVIDIA GPU", memoryMb = "0"] = first.split(",").map((part) => part.trim());
    return { vendor: "NVIDIA", name, vramGb: Math.round(Number(memoryMb) / 102.4) / 10, unified: false };
  }

  if (platform() === "darwin") {
    const info = execute("system_profiler", ["SPDisplaysDataType", "-json"]);
    try {
      const parsed = JSON.parse(info) as { SPDisplaysDataType?: Array<{ sppci_model?: string }> };
      return { vendor: "Apple", name: parsed.SPDisplaysDataType?.[0]?.sppci_model ?? "Apple Silicon", vramGb: Math.round(totalmem() / 2 ** 30), unified: true };
    } catch { /* fall through */ }
  }

  if (platform() === "win32") {
    const script = "Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress";
    const info = execute("powershell", ["-NoProfile", "-Command", script]);
    try {
      const parsed = JSON.parse(info) as { Name?: string; AdapterRAM?: number };
      const name = parsed.Name ?? "Unknown GPU";
      const vendor: GpuVendor = /amd|radeon/i.test(name) ? "AMD" : /intel|arc/i.test(name) ? "Intel" : /nvidia|geforce/i.test(name) ? "NVIDIA" : "CPU only";
      return { vendor, name, vramGb: Math.max(0, Math.round((parsed.AdapterRAM ?? 0) / 2 ** 30)), unified: false };
    } catch { /* fall through */ }
  }

  const pci = execute("lspci", []);
  const display = pci.split(/\r?\n/).find((line) => /VGA|3D/i.test(line));
  if (display) {
    const vendor: GpuVendor = /nvidia/i.test(display) ? "NVIDIA" : /amd|radeon/i.test(display) ? "AMD" : /intel/i.test(display) ? "Intel" : "CPU only";
    return { vendor, name: display.replace(/^.*?:\s*/, ""), vramGb: 0, unified: false };
  }
  return { vendor: "CPU only", name: "CPU only", vramGb: 0, unified: false };
}

function storageFreeGb() {
  if (platform() === "win32") {
    const value = execute("powershell", ["-NoProfile", "-Command", "[math]::Round((Get-PSDrive -Name ($PWD.Path.Substring(0,1))).Free / 1GB, 1)"]);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } else {
    const lines = execute("df", ["-Pk", "."]).split(/\r?\n/);
    const fields = lines.at(-1)?.trim().split(/\s+/);
    const parsed = Number(fields?.[3]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round((parsed / 1024 / 1024) * 10) / 10;
  }
  return 1;
}

export interface SystemMetrics {
  systemMemoryUsedGb?: number;
  gpuMemoryUsedGb?: number;
  gpuUtilizationPercent?: number;
  gpuTemperatureC?: number;
  gpuPowerWatts?: number;
}

export function systemSnapshot(): SystemMetrics {
  const snapshot: SystemMetrics = { systemMemoryUsedGb: Math.round(((totalmem() - freemem()) / 2 ** 30) * 10) / 10 };
  const output = execute("nvidia-smi", [
    "--query-gpu=memory.used,utilization.gpu,temperature.gpu,power.draw",
    "--format=csv,noheader,nounits"
  ]);
  if (!output) return snapshot;
  const [memoryMb, utilization, temperature, power] = (output.split(/\r?\n/)[0] ?? "").split(",").map((part) => Number(part.trim()));
  if (memoryMb !== undefined && Number.isFinite(memoryMb)) snapshot.gpuMemoryUsedGb = Math.round((memoryMb / 1024) * 10) / 10;
  if (utilization !== undefined && Number.isFinite(utilization)) snapshot.gpuUtilizationPercent = utilization;
  if (temperature !== undefined && Number.isFinite(temperature)) snapshot.gpuTemperatureC = temperature;
  if (power !== undefined && Number.isFinite(power)) snapshot.gpuPowerWatts = Math.round(power * 10) / 10;
  return snapshot;
}

export function processInventory() {
  if (platform() === "win32") {
    return execute("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress"], 8_000).toLowerCase();
  }
  return execute("ps", ["-axo", "comm=,args="], 8_000).toLowerCase();
}

export function hardwareProbe(): {
  hardware: HardwareSpec;
  fingerprint: string;
  publicRigId: string;
  cpuScore: number;
  memoryBandwidthGbps: number;
} {
  const gpu = detectGpu();
  const cpuList = cpus();
  const start = performance.now();
  let accumulator = 0;
  for (let i = 1; i <= 2_000_000; i++) accumulator += Math.sqrt(i) * Math.sin(i % 97);
  const duration = Math.max(1, performance.now() - start);
  const cpuScore = Math.round((2_000_000 / duration) * Math.max(1, cpuList.length / 4));

  const bytes = 64 * 1024 * 1024;
  const source = new Uint8Array(bytes);
  const destination = new Uint8Array(bytes);
  source[0] = Math.abs(Math.round(accumulator)) % 255;
  const memoryStart = performance.now();
  for (let i = 0; i < 6; i++) destination.set(source);
  const memorySeconds = Math.max(0.001, (performance.now() - memoryStart) / 1000);
  const memoryBandwidthGbps = Math.round(((bytes * 6) / memorySeconds / 1e9) * 10) / 10;

  const hardware: HardwareSpec = {
    gpuVendor: gpu.vendor,
    gpuName: gpu.name,
    vramGb: gpu.vramGb,
    systemRamGb: Math.round(totalmem() / 2 ** 30),
    unifiedMemory: gpu.unified,
    cpuCores: cpuList.length,
    cpuModel: cpuList[0]?.model ?? "Unknown CPU",
    operatingSystem: type(),
    architecture: arch(),
    storageFreeGb: storageFreeGb(),
    runtime: gpu.vendor === "Apple" ? "MLX" : "Ollama",
    workload: "Everyday chat",
    contextTarget: 8192
  };
  const identity = hardwareIdentity(hardware);
  return { hardware, ...identity, cpuScore, memoryBandwidthGbps };
}
