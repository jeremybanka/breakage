# breakage workspace

- Keep project-level contributor, maintenance, release, and documentation guidance here. Put package-specific guidance alongside each package.
- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.
- Put reusable packages in `packages/` and applications in `apps/`.
- Use the canonical commands in `docs/commands.md`: `fmt` writes formatting, `check` aggregates `check:*` validators, and `test` runs once. Coverage commands use the `cov` prefix where implemented. Keep CI and documentation aligned when changing commands.
- Do not put line breaks in changeset bodies; keep each body on a single line.
- Before 1.0.0, use patch releases for features and bug fixes, and minor releases for breaking changes.

## Vite Plus upgrades

Use the target release's official `vp migrate --no-interactive` for Vite Plus upgrades. Preserve the old lockfile until migration runs, and let the migrator own toolchain version alignment and supported source/configuration changes. Review its manual migration findings and run the repository's formatter and checks; do not maintain a separate dependency synchronization implementation.

## Dependency release age

Packages authored by jeremybanka are exempt from minimum release age requirements at every version, including transitive dependencies. Keep their names aligned between `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` and the corresponding npm rule in `renovate.json`. Update both lists when adding a first-party package.

## Markdown

Keep each paragraph and list item on one source line; do not manually wrap prose at a fixed width.

## First publication

The first publication under the `breakage` name deliberately retains version 0.8.1 from break-check. Its migration notes live directly in the 0.8.1 changelog entry; do not add a version-bumping changeset for the repository move and rename. Subsequent changes follow the usual Changesets policy above.
