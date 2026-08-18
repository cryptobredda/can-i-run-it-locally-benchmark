# Benchmark and upload protocol

## `ciritl-quick-v1`

1. Detect a bounded hardware summary.
2. Discover running local runtimes and loaded models.
3. Ask the contributor to select a runtime/model when more than one is available.
4. Run the fixed prompt with temperature `0`, deterministic seed `42` where supported, and an eight-token warm-up.
5. Run the same prompt for 128 measured output tokens by default.
6. Prefer runtime-native prompt/decode timings; otherwise measure the streaming boundary.
7. Validate and display the schema-v2 contribution.
8. Upload only after affirmative consent.

The fixed prompt is:

> Explain in three concise paragraphs why memory bandwidth matters for local language-model inference.

The contributor may change context and measured output length. Both values are included in every result so comparisons can filter like-for-like runs.

## Upload contract

`POST /api/v1/benchmarks` receives JSON with `schemaVersion: 2`, `consent: true`, client/run identity, normalized hardware, model/runtime metadata, token counts, rates, durations, metric provenance, probe results, and optional utilization snapshots.

The public rig ID is the first 64 bits of the SHA-256 configuration fingerprint rendered in four hexadecimal groups. The receiving service independently recomputes the fingerprint from the submitted hardware fields.

The receiving service may return:

- `201 accepted` or `201 quarantined`;
- `200 duplicate`;
- `401 unauthorized` when emergency keyed ingestion is enabled;
- `422 validation_failed` or `identity_mismatch`;
- `429 rate_limited`;
- `503 storage_not_configured`.
