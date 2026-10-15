# breakage workspace

- Keep project-level contributor, maintenance, release, and documentation guidance here. Put package-specific guidance alongside each package.
- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.
- Put reusable packages in `packages/` and applications in `apps/`.
- Use the canonical commands in `docs/commands.md`: `fmt` writes formatting, `check` aggregates `check:*` validators, and `test` runs once. Coverage commands use the `cov` prefix where implemented. Keep CI and documentation aligned when changing commands.
- Do not put line breaks in changeset bodies; keep each body on a single line.
- Before 1.0.0, use patch releases for features and bug fixes, and minor releases for breaking changes.

## Vite Plus upgrades

Use the target release's official `vp migrate --no-interactive` for Vite Plus upgrades. Preserve the old lockfile until migration runs, and let the migrator own toolchain version alignment and supported source/configuration changes. Review its manual migration findings and run the repository's formatter and checks; do not maintain a separate dependency synchronization implementation.
