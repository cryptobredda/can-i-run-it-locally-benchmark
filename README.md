# can I run it locally .ai — public benchmark client

An inspectable, account-free benchmark for measuring local language-model performance. It detects your hardware and running local AI servers, lets you choose the runtime and loaded model, performs a short warm-up plus measured pass, then shows the exact contribution before you decide whether to send it.

This repository contains only the public client and its wire protocol. The website, database, moderation system, deployment configuration, and private product code live elsewhere.

## Supported runtimes

- Ollama native API
- vLLM OpenAI-compatible server
- LM Studio local server
- llama.cpp server
- MLX-LM server
- LocalAI
- Other local OpenAI-compatible chat-completion servers

Automatic discovery checks loopback ports `11434`, `1234`, `8000`, and `8080`. A custom local endpoint can be selected explicitly.

## Quick start

Requirements: Node.js 22.12 or newer and at least one running local AI server with a loaded model.

```bash
git clone https://github.com/cryptobredda/can-i-run-it-locally-benchmark.git
cd can-i-run-it-locally-benchmark
npm install
npm run bench
```

The guided flow lists every detected runtime and model. It then asks for context/output settings, runs the test locally, prints the full contribution preview, and asks `Contribute this public result? [y/N]`.

Useful commands:

```bash
# Discovery only
npm run bench -- --scan

# Local test without the contribution question
npm run bench -- --runtime ollama --model qwen3:8b --no-upload

# Explicit vLLM endpoint and model
npm run bench -- --runtime vllm --base-url http://127.0.0.1:8000 --model Qwen/Qwen3-8B

# Non-interactive contribution requires explicit consent
npm run bench -- --runtime lm-studio --base-url http://127.0.0.1:1234 --model qwen3-8b --upload --yes
```

Run `npm run bench -- --help` for every option. Override the contribution service with `--submit-url` or `CIRITL_SUBMIT_URL`.

## What the test measures

Protocol `ciritl-quick-v1` uses temperature zero, a fixed prompt, an eight-token warm-up, and a 128-token measured pass by default. It records:

- prompt and generated token counts;
- prompt-processing and generation tokens per second;
- time to first token when streaming exposes it;
- generation and end-to-end duration;
- runtime name/version, model tag, quantisation, and context;
- CPU/GPU/RAM configuration and a small CPU/memory-copy probe;
- optional NVIDIA memory, utilization, temperature, and power snapshots.

Runtime-native timing is preferred. OpenAI-compatible servers without native timing are measured at the client streaming boundary and marked accordingly.

## Privacy and contributor identity

The client never reads or submits your name, email, account, hostname, username, file list, prompts/files, MAC address, or hardware serial number. The fixed benchmark prompt is part of this source code.

It derives a stable public call sign such as `RIG-7A3F-91C2-0BD4-77E8` from normalized CPU, GPU, VRAM, RAM, OS-family, and architecture fields. Storage capacity, runtime/model choice, and benchmark settings are excluded. This identifies a reported configuration—not a person—and identical rigs can share a call sign.

Nothing is uploaded unless you approve the preview. See [docs/privacy.md](docs/privacy.md) for the exact field list and limitations.

## Development and verification

```bash
npm ci
npm run verify
```

Tests use mock local HTTP servers; they do not download models or contact the contribution service. CI runs typechecking, unit/adapter tests, a production bundle, and the bundled `--help` smoke test on Linux, Windows, and macOS.

See [the protocol](docs/protocol.md), [contributing](CONTRIBUTING.md), and [security policy](SECURITY.md).
