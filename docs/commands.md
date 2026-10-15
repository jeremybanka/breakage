# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` pins Node.js and pnpm and adds the root's `node_modules/.bin` to `PATH`.

| Command            | Contract                                                  |
| ------------------ | --------------------------------------------------------- |
| `fmt`              | Apply the repository formatting policy.                   |
| `check`            | Run all `check:*` validators.                             |
| `check:fmt`        | Check formatting with dprint.                             |
| `check:vp`         | Run Vite Plus linting and TypeScript checks.              |
| `check:spelling`   | Check spelling with CSpell.                               |
| `test`             | Build the package and run its Bun tests once.             |
| `test:watch`       | Run the package’s Bun tests in watch mode.                |
| `build`            | Run workspace package build scripts when available.       |
| `dev`              | Run workspace package development scripts when available. |
| `change`           | Author pending release notes for publishable packages.    |
| `release:version`  | Prepare package versions and release metadata.            |
| `release:publish`  | Build and publish packages through Changesets.            |
| `staged`           | Format and check staged files.                            |
| `workflows:update` | Update pinned workflow action references and mise.        |

Vite Plus enables type-aware linting and TypeScript checking. Formatting is handled separately by dprint. Add package-specific checks as needed and include them in `check` and CI.

The `breakage` package builds with tsdown and generates its configuration schemas. `test` and `test:watch` dispatch to package scripts through Vite Plus. The test command builds first so CLI tests exercise the distributable entrypoint; fixture tests are run only inside their disposable Git repositories. Bun is a development dependency provided by mise; the published CLI runs on Node.js.

`workflows:update` reads GitHub tags using Git and requires network access. Pass `--dry-run` to preview updates: `pnpm workflows:update --dry-run`.

Vite Plus upgrades must use the target release's official `vp migrate --no-interactive`; preserve the existing lockfile until that command runs.
