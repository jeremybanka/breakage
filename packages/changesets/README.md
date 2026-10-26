# @breakage/changesets

Changesets release intent for [Breakage](../breakage/README.md). Install the integration once; it owns the Changesets libraries and workspace discovery it needs.

```sh
npm install --save-dev breakage @breakage/changesets
```

Keep `@changesets/cli` for your normal Changesets commands. It is not a runtime dependency or peer of this integration. The only peer is `breakage`, which supplies the release model.

```ts
import { changesetsReleaseDelta } from "@breakage/changesets"
import { defineConfig, semverPolicy } from "breakage"

export default defineConfig({
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
})
```

`changesetsReleaseDelta({ directory? })` returns a resolver for `release.resolveDelta`. It reads the Changesets plan, including dependent bumps and prerelease state, and returns the version transition from the selected baseline to the planned release. After Changesets versioning consumes the pending changesets, it uses the current manifest version, preserving the same release intent. Without a baseline, it compares against the current manifest, supplying candidate identity. Breakage's policy decides whether the transition permits breaking changes; the resolver does not approve breakage itself.

By default, workspace discovery starts from the resolver context's package directory. Pass `directory` to select an explicit workspace. Configuration and plan errors propagate as setup failures; they do not silently fall back to manifest versions.

For custom composition, `readChangesetsReleasePlan(directory?)` returns a `ReadonlyMap<string, string>` of package names to planned versions. Its default directory is `process.cwd()`.

```ts
import { readChangesetsReleasePlan } from "@breakage/changesets"

const versions = await readChangesetsReleasePlan()
const intendedVersion = versions.get("my-package")
```

## Migration

The former `breakage/changesets` export has been removed. Install `@breakage/changesets` and change the import path; both helper APIs are unchanged. You can remove direct installations of `@changesets/assemble-release-plan`, `@changesets/config`, `@changesets/pre`, `@changesets/read`, and `@manypkg/get-packages` if nothing else uses them.

## Compatibility environments

`environments/changesets-3.0.0` preserves CLI 3.0.0 and the minimum direct dependency versions supported by the integration. `environments/changesets-3.x` tracks current versions within the supported majors. Transitive dependencies retain their own version requirements. These pins are test inputs; consumers do not need to install these libraries individually.

Run `pnpm run test:breakage:npm` from the repository root. It tests both packed packages in these environments, verifies that the integration resolves the pinned libraries, and exercises release planning before and after actual Changesets versioning. It also checks release planning in a fresh consumer without the CLI or explicit internal dependencies, adds the CLI for versioning checks, and tests a core-only consumer. Matrix orchestration is outside this package's scope.
