# Peer compatibility roadmap

Extend breakage's released consumer contracts across the peer environments a package promises to support. Deliver these milestones in order; each has an observable completion criterion.

## 1 Prove workspace compatibility checks

- [x] Add a disposable workspace example with a plugin and a host, using project commands through the existing `testCommand` hook.
- [x] Exercise current plugin with current host, current plugin with released host, and released plugin with current host where the release plan promises support.
- [x] Done when a coordinated change passes current workspace tests but fails the appropriate mixed combination for the intended compatibility regression.

## 2 Run explicitly selected peer cases

- [x] Introduce an opt-in matrix of exact peer versions and project-provided setup and test commands. Keep released assertions fixed across cases.
- [x] Report the contract baseline, candidate package, exact peer versions, and outcome for each case; distinguish setup failures from contract failures.
- [x] Done when one failing case fails the check and the report identifies the affected combination.

## 3 Preserve peer support promises

- [x] Preserve released peer ranges alongside released assertions. Compare them with the proposed release's ranges so editing both tests and metadata cannot silently erase support.
- [x] Route dropped support through intentional-break certification. Require retained support to pass; validate newly added support with current integration contracts.
- [x] Done when narrowing a range requires certification and a version bump cannot excuse a failing combination still claimed as supported.

## 4 Install isolated peer environments

- [ ] Add isolated setup for exact external peer releases and historical releases of workspace peers, starting with this repository's package manager.
- [ ] Ensure the candidate uses the selected peer instance and historical cases cannot resolve to the current workspace package. Preserve the developer's installation and clean up temporary environments.
- [ ] Done when the same integration contract passes against one exact peer release and detects a representative regression against another, with verified resolution.

## 5 Resolve ranges into pinned cases

- [ ] Extend the uncached prelude to select the lowest published and newest satisfying stable versions in each supported range segment and major; deduplicate cases and allow explicit additions.
- [ ] Record exact versions and reproducible dependency resolution inputs in a deterministic snapshot used by checks and cache keys. Fail unresolved ranges rather than skip them.
- [ ] Done when `^2.4.0 || ^3.1.0` covers both lower bounds and both latest supported majors, and a newly selected release invalidates the cached comparison. Report tested versions as samples of the declared range.

## 6 Support multiple peers deliberately

- [ ] Add explicitly selected combinations, validate their dependency constraints, and enforce a configurable matrix size limit.
- [ ] Include absence cases for optional peers and define explicit selection policies for prereleases and unbounded ranges.
- [ ] Done when incompatible combinations produce useful diagnostics and matrix limits require an explicit selection instead of silently reducing coverage.

Keep the first useful release focused on explicit cases. Automatic range discovery follows once contract preservation, environment isolation, and failure reporting work reliably.
