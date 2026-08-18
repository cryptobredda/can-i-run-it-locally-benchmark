# Privacy field inventory

## Collected locally

- CPU model and logical core count;
- GPU vendor/name and reported VRAM;
- total RAM, unified-memory flag, OS family, and architecture;
- free storage capacity for local compatibility reporting;
- small CPU and memory-copy probe scores;
- running-process text used only to distinguish local server implementations;
- optional NVIDIA utilization snapshot after the measured run.

Process inventory and free storage are not part of the identity fingerprint. Process inventory is never added to the report or upload.

## Included in a contribution

- normalized hardware fields and configuration fingerprint/call sign;
- client version and random per-run UUID;
- runtime/model/quantisation/context metadata;
- prompt/generated token counts, throughput, durations, and timing provenance;
- CPU/memory probe scores and optional utilization snapshot.

## Never included

Name, email, account, hostname, username, filesystem contents, environment variables, MAC address, IP address, hardware serial numbers, or private prompts/files.

The destination service necessarily sees the network source of an HTTP request and may use it transiently for abuse prevention. This client does not place that address in the contribution payload.
