# Security policy

Do not open a public issue for a vulnerability. Use GitHub Security Advisories on this repository to report it privately.

## Client security model

- Automatic discovery probes fixed loopback URLs only.
- Custom endpoints require an explicit command-line value.
- Contributions require an on-screen preview and consent; non-interactive uploads also require `--yes`.
- HTTP responses, payload sizes, schemas, numeric ranges, and timeouts are bounded.
- The client does not execute model output or download models.
- The client is open source, so the receiving service treats every submission as untrusted.

Before a release, run `npm run verify`, review dependency changes, and inspect the generated `dist/index.js` bundle.
