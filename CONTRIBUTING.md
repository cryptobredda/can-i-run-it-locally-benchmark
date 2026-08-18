# Contributing

Use Node.js 22.12 or newer and install with `npm ci`.

Before opening a pull request:

```bash
npm run verify
```

Runtime changes should include fixture-backed tests for discovery and measurements. Keep collection bounded, disclose every submitted field, probe loopback endpoints by default, and never add background telemetry or account identifiers.

The contribution payload is a public contract. Incompatible changes require a new `schemaVersion` and benchmark protocol identifier rather than silently changing `ciritl-quick-v1`.
