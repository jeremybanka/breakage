# Peer compatibility roadmap

Extend breakage from its public relationship with its own past to named peer embassy contracts. A test can belong to several relationships: public checks use released assertions, while embassy checks use current assertions and swap the peer. Completed milestones follow the final execution model below.

## 1 Prove workspace compatibility checks

- [x] Demonstrate a coordinated workspace change that passes current tests but fails a supported mixed-version combination.
- [x] Materialize exact workspace peer releases from Git without changing the candidate package or current embassy suite.
- [x] Include historical workspace runtime dependencies and reject missing releases rather than leaking current peer code.

## 2 Run current embassy suites

- [x] Configure named test selections for peer relationships, allowing overlap with public contracts and other embassies.
- [x] Run every inferred embassy environment against current assertions, including before the package's first release.
- [x] Report the candidate, embassy, exact peer versions, and setup or contract failures.

## 3 Validate declared support groups

- [x] Treat each explicit semver alternative as a meaningful group, preserving irregular, overlapping, prerelease, and open-ended ranges.
- [x] Require exact `<peer>_v<label>` development aliases whose targets match the peer and cover every declared group.
- [x] Explain uncovered groups, wrong targets, unpinned versions, and out-of-range pins with actionable manifest diagnostics.

## 4 Install isolated peer environments

- [x] Materialize candidate and historical peer sources in detached Git worktrees that share repository objects and clean up after each check.
- [x] Delegate installation and builds to repository-defined preparation, with an explicit optional pnpm installer.
- [x] Prove a Bun preparation workflow installs and builds pinned Git sources with pnpm unavailable.
- [x] Verify canonical peer resolution from both the candidate and the test environment, preserving the developer's installation.
- [x] Support explicit release archives, runner dependencies, and setup commands.

## 5 Preserve pinned representatives

- [x] Let maintainers and dependency updaters change individual exact pins; never select a newer representative automatically.
- [x] Record inferred environments, commands, source commits, and archive hashes in prelude snapshots; the pnpm installer also records package archives and dependency locks.
- [x] Reject stale snapshots and corrupted artifacts; replay pinned workspace sources without release discovery, with custom preparation owning its toolchain's reproducibility.

## 6 Handle multiple peers and optional dependencies

- [x] Scope each embassy to its participating peers and infer compatible combinations from pinned dependencies.
- [x] Include optional absence and enforce coverage of every pin without silently truncating matrices.
- [x] Report incompatible dependency combinations and enforce a configurable environment limit.

See the [peer compatibility documentation](../packages/breakage/README.md#peer-compatibility) for configuration and reproducible checks.
