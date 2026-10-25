---
"breakage": minor
---

Replace certification hooks and JSON configuration with TypeScript configuration, function resolveDelta and policy hooks, and shell-string test commands; share release evidence across public and npm checks with beforeV1 and optional Changesets helpers that preserve intent after versioning, return validated version transitions through changesetsReleaseDelta() and apply policy separately, and resolve config paths relative to their files. Use Comline 0.9.3 asynchronous configuration loading, config-only options, and strict schemas to support top-level await, preserve hooks, reject unknown keys, and derive authored config types. Validate the packed Changesets integration in authored peer environments.
