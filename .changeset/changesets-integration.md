---
"breakage": minor
"@breakage/changesets": patch
---

Move the Changesets helpers from `breakage/changesets` into `@breakage/changesets`, which owns its Changesets and workspace-discovery dependencies. Install `@breakage/changesets` alongside `breakage` and update helper imports; the helper API is unchanged. Core no longer declares Changesets optional peers. Verify the integration against minimum and current Changesets 3 environments.
