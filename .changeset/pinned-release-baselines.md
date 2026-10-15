---
"breakage": patch
---

Add an uncached `breakage prelude` command and `breakagePrelude` API that resolve and fetch a release into an atomically written, gitignored snapshot. Use `--baseline-file` or `baselineFile` to replay contracts from that exact commit without rediscovering remote tags, allowing task runners to cache compatibility checks while invalidating them for new releases or moved tags. Document Turbo deferred hashing and compatibility replay against the tested package’s source while preserving ordinary checks, certification, and test restoration.
