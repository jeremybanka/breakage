---
"breakage": minor
---

Replace certification commands and npm releaseIntent/certifyBreaking hooks with a shared release version and policy model, including beforeV1 and optional Changesets helpers that preserve intent after versioning; consolidate shell and inline tasks, remove certification result fields in favor of version-delta evidence, and resolve config directories relative to their files. JSON configurations and shell-command strings remain supported.
