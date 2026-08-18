#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { benchmarkUploadV2Schema, hardwareSpecSchema, type BenchmarkUploadV2 } from "./protocol";
import { matchCatalogueModel } from "./model-match";
import { hardwareProbe, systemSnapshot } from "./probe";
import { createRuntimeAdapter, detectRuntimes, parseRuntimeKey } from "./runtime-adapters";
import type { DetectedModel, RuntimeCandidate } from "./types";

const VERSION = "0.2.0";
const DEFAULT_SUBMIT_URL = process.env.CIRITL_SUBMIT_URL ?? "https://canirunitlocally.ai";
const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueFor = (...flags: string[]) => {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index >= 0) return args[index + 1];
  }
  return undefined;
};

if (has("--help") || has("-h")) {
  console.log(`can I run it locally .ai benchmark client v${VERSION}

Usage:
  npm run bench                         Guided scan, benchmark and contribution
  npm run bench -- --scan              Show detected runtimes and models
  npm run bench -- --runtime vllm --model Qwen/Qwen3-8B
  npm run bench -- --runtime lm-studio --model qwen3-8b --upload

Options:
  --runtime <name>      ollama, lm-studio, vllm, llama.cpp, mlx, localai or openai
  --base-url <url>      Custom local runtime URL
  --model <id>          Runtime model ID or tag
  --context <tokens>    Context window used for the run (default: 8192)
  --tokens <count>      Measured output tokens (default: 128)
  --submit-url <url>    Contribution server (default: ${DEFAULT_SUBMIT_URL})
  --upload              Offer or perform contribution after the test
  --no-upload           Run locally without the contribution question
  --yes                 Confirm contribution non-interactively
  --api-key <key>       Optional emergency upload key
  --scan                Detect runtimes and models without testing
  --json                Print the result as JSON
  --help                Show this help`);
  process.exit(0);
}

const jsonMode = has("--json");
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !jsonMode);
const terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;

async function ask(question: string, fallback?: string) {
  if (!terminal) return fallback;
  const answer = (await terminal.question(question)).trim();
  return answer || fallback;
}

async function choose<T>(question: string, choices: T[], label: (choice: T) => string) {
  if (choices.length === 1) return choices[0]!;
  if (!terminal) return undefined;
  console.log(`\n${question}`);
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${label(choice)}`));
  while (true) {
    const answer = Number(await ask(`Choose 1–${choices.length}: `));
    if (Number.isInteger(answer) && answer >= 1 && answer <= choices.length) return choices[answer - 1]!;
    console.log("Enter one of the numbers shown above.");
  }
}

function numberOption(flag: string, fallback: number, min: number, max: number) {
  const raw = valueFor(flag);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

function printScan(candidates: RuntimeCandidate[]) {
  if (!candidates.length) {
    console.log("No running local AI server was found on the standard loopback ports.");
    console.log("Start Ollama, LM Studio, vLLM, llama.cpp, MLX-LM or LocalAI, or pass --runtime and --base-url.");
    return;
  }
  console.log(`Found ${candidates.length} running local AI runtime${candidates.length === 1 ? "" : "s"}:`);
  for (const candidate of candidates) {
    console.log(`\n  ${candidate.label} ${candidate.version === "unknown" ? "" : `v${candidate.version}`} · ${candidate.baseUrl}`.trimEnd());
    if (!candidate.models.length) console.log("    No loaded models reported");
    for (const model of candidate.models) {
      const details = [model.parameterSize, model.quantization !== "unknown" ? model.quantization : undefined].filter(Boolean).join(" · ");
      console.log(`    • ${model.name}${details ? ` (${details})` : ""}${model.catalogueSlug ? ` → ${model.catalogueSlug}` : ""}`);
    }
  }
}

try {
  const probe = hardwareProbe();
  const requestedRuntimeValue = valueFor("--runtime");
  const requestedRuntime = requestedRuntimeValue ? parseRuntimeKey(requestedRuntimeValue) : undefined;
  if (requestedRuntimeValue && !requestedRuntime) throw new Error(`Unsupported runtime '${requestedRuntimeValue}'. Run with --help for the supported names.`);
  const legacyOllamaUrl = valueFor("--ollama");
  const baseUrl = valueFor("--base-url") ?? legacyOllamaUrl;
  if (baseUrl && !requestedRuntime && !legacyOllamaUrl) throw new Error("--base-url also requires --runtime so the adapter can be selected safely.");

  if (!jsonMode) {
    console.log("\ncan I run it locally .ai — public quick test");
    console.log(`Rig       ${probe.publicRigId} · configuration-derived, no account`);
    console.log(`GPU       ${probe.hardware.gpuName} (${probe.hardware.vramGb} GB)`);
    console.log(`Memory    ${probe.hardware.systemRamGb} GB · ${probe.hardware.cpuCores} logical CPU cores`);
    console.log(`Probe     CPU ${probe.cpuScore} · memory copy ${probe.memoryBandwidthGbps} GB/s`);
    console.log("\nScanning local runtime endpoints…");
  }

  const candidates = await detectRuntimes(baseUrl ? { key: requestedRuntime ?? "ollama", baseUrl } : undefined);

  if (has("--scan")) {
    if (jsonMode) console.log(JSON.stringify({ publicRigId: probe.publicRigId, hardware: probe.hardware, runtimes: candidates }, null, 2));
    else printScan(candidates);
    process.exitCode = candidates.length ? 0 : 2;
  } else {
    if (!candidates.length) throw new Error("No compatible running runtime was found. Start one or use --runtime <name> --base-url <url>.");
    const eligible = requestedRuntime ? candidates.filter((candidate) => candidate.key === requestedRuntime) : candidates;
    if (!eligible.length) throw new Error(`The requested ${requestedRuntimeValue} server did not respond with a compatible API.`);

    const requestedModel = valueFor("--model");
    const runtimeWithModel = requestedModel
      ? eligible.filter((candidate) => candidate.models.some((model) => model.id === requestedModel || model.name === requestedModel))
      : eligible;
    const runtimeChoices = runtimeWithModel.length ? runtimeWithModel : eligible;
    const runtime = await choose("Which runtime should be tested?", runtimeChoices, (candidate) => `${candidate.label} · ${candidate.detail} · ${candidate.baseUrl}`);
    if (!runtime) throw new Error("Multiple runtimes were found. Re-run interactively or pass --runtime and --base-url.");

    let model: DetectedModel | undefined;
    if (requestedModel) {
      const matched = matchCatalogueModel(requestedModel);
      model = runtime.models.find((entry) => entry.id === requestedModel || entry.name === requestedModel)
        ?? { id: requestedModel, name: requestedModel, quantization: "unknown", ...(matched ? { catalogueSlug: matched.slug } : {}) };
    } else if (runtime.models.length) {
      model = await choose("Which installed model should be tested?", runtime.models, (entry) => `${entry.name}${entry.quantization === "unknown" ? "" : ` · ${entry.quantization}`}${entry.catalogueSlug ? " · catalogue match" : ""}`);
    } else if (terminal) {
      const manual = await ask("The server reported no models. Enter a model ID manually: ");
      const matched = manual ? matchCatalogueModel(manual) : undefined;
      if (manual) model = { id: manual, name: manual, quantization: "unknown", ...(matched ? { catalogueSlug: matched.slug } : {}) };
    }
    if (!model) throw new Error("No model was selected. Pass --model <runtime-model-id> when running non-interactively.");

    let context = numberOption("--context", Math.max(2048, Math.min(8192, model.contextLength ?? 8192)), 2048, 1_048_576);
    let maxTokens = numberOption("--tokens", 128, 16, 4096);
    if (interactive && valueFor("--context") === undefined) context = Number(await ask(`Context tokens [${context}]: `, String(context)));
    if (interactive && valueFor("--tokens") === undefined) maxTokens = Number(await ask(`Measured output tokens [${maxTokens}]: `, String(maxTokens)));
    if (!Number.isInteger(context) || context < 2048 || context > 1_048_576) throw new Error("Context must be a whole number from 2048 to 1048576.");
    if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 4096) throw new Error("Output tokens must be a whole number from 16 to 4096.");

    probe.hardware.runtime = runtime.runtime;
    probe.hardware.contextTarget = context;
    if (!jsonMode) {
      console.log(`\nSelected  ${runtime.label} ${runtime.version === "unknown" ? "" : `v${runtime.version}`} · ${model.name}`.trimEnd());
      console.log(`Protocol  warm-up → fixed prompt → ${maxTokens}-token measured pass`);
      console.log("Running warm-up and measured pass…");
    }

    const metrics = await createRuntimeAdapter(runtime).benchmark({ model: model.id, context, maxTokens });
    const report = {
      clientVersion: VERSION,
      publicRigId: probe.publicRigId,
      hardware: hardwareSpecSchema.parse(probe.hardware),
      runtime: { name: runtime.runtime, version: runtime.version, baseUrl: runtime.baseUrl },
      model: { id: model.id, name: model.name, catalogueSlug: model.catalogueSlug ?? null, quantization: model.quantization },
      protocol: "ciritl-quick-v1" as const,
      probe: { cpuScore: probe.cpuScore, memoryBandwidthGbps: probe.memoryBandwidthGbps },
      metrics
    };

    if (jsonMode) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("\nBenchmark complete");
      console.log(`Generation ${metrics.generationTps.toFixed(1)} tok/s · ${metrics.generatedTokens} tokens`);
      console.log(`Prompt     ${metrics.promptTps.toFixed(0)} tok/s · ${metrics.promptTokens} tokens`);
      if (metrics.timeToFirstTokenMs !== undefined) console.log(`First token ${metrics.timeToFirstTokenMs.toFixed(0)} ms`);
      console.log(`End-to-end ${metrics.endToEndMs} ms · metrics from ${metrics.metricSource}`);
    }

    const upload: BenchmarkUploadV2 = benchmarkUploadV2Schema.parse({
      schemaVersion: 2,
      consent: true,
      clientVersion: VERSION,
      hardwareFingerprint: probe.fingerprint,
      publicRigId: probe.publicRigId,
      clientRunId: randomUUID(),
      benchmarkProtocol: "ciritl-quick-v1",
      hardware: report.hardware,
      modelSlug: model.catalogueSlug ?? null,
      modelTag: model.id,
      quantization: model.quantization,
      context,
      promptTokens: metrics.promptTokens,
      generatedTokens: metrics.generatedTokens,
      promptTps: metrics.promptTps,
      generationTps: metrics.generationTps,
      durationMs: metrics.durationMs,
      backendVersion: runtime.version,
      runtimeVersion: runtime.version,
      metricSource: metrics.metricSource,
      endToEndMs: metrics.endToEndMs,
      generationDurationMs: metrics.generationDurationMs,
      ...(metrics.timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs: metrics.timeToFirstTokenMs } : {}),
      ...(metrics.loadTimeMs !== undefined ? { loadTimeMs: metrics.loadTimeMs } : {}),
      probe: report.probe,
      systemMetrics: systemSnapshot()
    });

    let contribute = has("--upload") || has("--yes");
    if (has("--no-upload")) contribute = false;
    if (interactive && !has("--no-upload")) {
      console.log("\nComplete contribution preview (hostname, username and files are never included):");
      console.log(JSON.stringify(upload, null, 2));
      const answer = await ask("Contribute this public result? [y/N] ", "n");
      contribute = /^y(es)?$/i.test(answer ?? "");
    }

    if (contribute) {
      if (!interactive && !has("--yes")) throw new Error("Non-interactive contribution requires --yes to record explicit consent.");
      const endpoint = (valueFor("--submit-url", "--endpoint") ?? DEFAULT_SUBMIT_URL).replace(/\/+$/, "");
      const key = valueFor("--api-key") ?? process.env.CIRITL_BENCHMARK_KEY;
      const response = await fetch(`${endpoint}/api/v1/benchmarks`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "x-benchmark-key": key } : {}) },
        body: JSON.stringify(upload),
        signal: AbortSignal.timeout(30_000)
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Contribution failed (${response.status}): ${body}`);
      if (!jsonMode) console.log(`\nContributed ${probe.publicRigId}: ${body}`);
    } else if (!jsonMode) {
      console.log("Result kept local. Re-run with --upload whenever you want to contribute it.");
    }
  }
} catch (error) {
  console.error(`\nBenchmark stopped: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  terminal?.close();
}
