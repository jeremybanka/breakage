# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` pins Node.js and pnpm and adds the root's `node_modules/.bin` to `PATH`.

| Command            | Contract                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `fmt`              | Apply the repository formatting policy.                                      |
| `check`            | Run all `check:*` validators.                                                |
| `check:fmt`        | Check formatting with dprint.                                                |
| `check:vp`         | Build workspace packages, then run Vite Plus linting and TypeScript checks.  |
| `check:spelling`   | Check spelling with CSpell.                                                  |
| `test`             | Build the package, prepare its fixtures, and run all current Bun tests once. |
| `test:prepare`     | Run workspace-owned fixture preparation tasks.                               |
| `test:public`      | Run current public consumer contracts against source once.                   |
| `test:breakage`    | Replay released public contracts with the pinned supervisor.                 |
| `test:watch`       | Run all current Bun tests in watch mode.                                     |
| `build`            | Run workspace package build scripts when available.                          |
| `dev`              | Run workspace package development scripts when available.                    |
| `change`           | Author pending release notes for publishable packages.                       |
| `release:version`  | Prepare package versions and release metadata.                               |
| `release:publish`  | Build Breakage and publish through Changesets.                               |
| `staged`           | Format and check staged files.                                               |
| `workflows:update` | Update pinned workflow action references and mise.                           |

Vite Plus enables type-aware linting and TypeScript checking. Formatting is handled separately by dprint. Add package-specific checks as needed and include them in `check` and CI.

Root workspace commands dispatch through `vp run -r <name>`. Each package owns its commands and prerequisites. Package scripts delegate to Vite Plus tasks with a `:run` suffix when they need dependency ordering: `check:vp` calls `check:vp:run`, and `test` calls `test:run`. The separate names let package scripts remain callable through pnpm without colliding with Vite Plus task definitions.

The root `check:vp:run` task depends on the workspace build before running Vite Plus linting and typechecking. Packages emit JavaScript and declarations with `vp pack`; Breakage also generates its configuration schemas. Fixture packages share one build configuration, which builds upstream packages first without per-fixture tsconfigs. The root TypeScript configuration covers all fixture sources, configuration, and contracts; authoring checks resolve package exports through their built declarations. Breakage retains its own TypeScript configuration for core compiler settings and its source alias.

Breakage's build configuration lives in its package's `vite.config.ts`. Release publishing and the CI packaging job target `vp run breakage#build`, so they build only the publishable package. Repository builds and validation still include every fixture package.

Breakage's uncached `test:run` task depends on its own build and `minimatch-integration#test:prepare`, then runs private integration tests and current public contracts. Full, sharded, and watch runs share this task; watch mode adds `--watch`. Installation, checks, packaging, and public-only tests do not prepare private fixtures. `pnpm run test:prepare` dispatches workspace preparation tasks explicitly. The [fixture guide](../packages/breakage/__tests__/fixtures/npm/README.md) describes npm preparation, offline installations, and disposable projects. Bun is provided by mise; the published CLI runs on Node.js.

`pnpm run test --shard=2/6` runs the second of six deterministic Bun test-file slices after building and preparing fixtures. New test files enter the partition automatically. Use the same total and checkout for every slice. Each CI shard has its own runner, checkout, dependency installation, build, and preparation; files within a shard run sequentially. All six shards continue even if one fails. Release packaging and historical compatibility run in separate jobs. The aggregate `Tests` result requires every shard and packaging to succeed, including when a dependency fails or is skipped; keep this stable result required alongside `Breakage`. Without `--shard`, `test` runs the complete suite.

`test:public` dispatches the package's public-only Bun command, fails when no tests are selected, and runs without building or preparing private fixtures. `test:breakage` must run from a clean repository with access to origin. It resolves a fresh release baseline on every invocation and runs only the released public command. The [self-check guide](../README.md#checking-breakage-with-breakage) documents the pinned supervisor, restore boundary, and explicit bootstrap exception for the three releases without public contracts.

`workflows:update` reads GitHub tags using Git and requires network access. Pass `--dry-run` to preview updates: `pnpm workflows:update --dry-run`.

Vite Plus upgrades must use the target release's official `vp migrate --no-interactive`; preserve the existing lockfile until that command runs.

The optional [npm peer workflow](../packages/breakage/npm.md) provides `breakage npm check`, `breakage npm check --coverage-only`, `breakage npm test <peer> <range>`, and `breakage npm test --representative <path>`. Release compatibility scripts keep the `test:breakage` name, with `test:breakage:npm` available as a separate required gate. The existing `test:breakage:prelude` remains for historical public checks; the npm workflow has no new prelude. The test suite exercises the built npm CLI and real offline npm packing and frozen installations in disposable repositories.
