# Breakage npm specification decisions

Deck version: 1. Completed: 22 of 22.

These answers resolve a design draft. Example commands and configuration are proposals, not released APIs.

## 1. Where should the npm features live?

Decision: A — An npm command family.

Ship one Breakage installation. An explicit npm namespace enables package discovery, peer checking, and workflow generation. Ordinary breakage commands never inspect npm metadata.

Example:

```text
breakage npm check
breakage npm actions generate
```

Tradeoff: One cohesive tool to install; the main distribution carries npm-specific machinery.

Reasoning: I could see _eventually_ breaking out the ecosystem-specific stuff as plugin-type packages, but, even then, I'd want it all to be one from the central `breakage` CLI

## 2. Does a run check a package or a release plan?

Decision: A — One publishable package.

Select the integration explicitly. Check its claimed peer support against released representatives. A workspace task runner can invoke the check for several packages.

Example:

```text
breakage npm check --package ./packages/react
# Candidate: React integration only
```

Tradeoff: A small, composable check; coordinated release reasoning stays outside this invocation.

Reasoning: I think this is the more expected behavior for monorepos and provides for better potential parallelism. Every package should be able to consider its own breakage status within the current environment.

## 3. Can an unpublished peer satisfy a check?

Decision: B — Explicit coordinated candidates.

Allow a peer candidate only when it appears in the same declared release plan. Report this result as conditional and require the exact peer release to be available before publishing the integration.

Example:

```text
React candidate + atom.io@1.3.0 candidate: pass
Publication prerequisite: publish atom.io@1.3.0 first
```

Tradeoff: Supports coordinated work; planning and publication must enforce the prerequisite.

Reasoning: This is essential. I work with changesets and encourage others to adopt an equivalent workflow. In this paradigm, changes to multiple packages are batched together and released in the correct order.

## 4. Where does release intent come from?

Decision: neither alternative.

Reasoning: Good question. My hope is that it's easy enough to express release intent via config--see how we handle this with "certifyCommand" currently. Though, the idea of "certify release intent for peer X" is a bit more complicated and implies parameterization. This might necessitate a move to a TypeScript breakage.config.ts

## 5. Which peers participate by default?

Decision: B — Local peers first.

Automatically check peer relationships crossing workspace release boundaries. External peer coverage is an explicit additional relationship with the same execution machinery.

Example:

```text
Automatic: React integration → atom.io
Opt in: React integration → react
```

Tradeoff: A focused initial experience; automatic coverage is intentionally narrower than the whole manifest.

Reasoning: I think breakage should facilitate running a correct external peer compatibility matrix with github actions, and this is recommended, and it will probably take the form of a special command like `breakage npm test <peer> <version>` => `breakage npm test react 18` This would run the testCommand for that peer with the appropriate version aliased in. This would leave the actual setup of your workflows to the developer, but make it simple to run what you want in your test matrix

## 6. Which current tests define a peer contract?

Decision: A — A dedicated peer suite.

Name a suite for each meaningful integration relationship. Its command and tracked test selection are explicit, and it can overlap with public contracts.

Example:

```text
"peers": { "testCommand": "bun test tests/peers" }
```

Tradeoff: Precise coverage and diagnostics; authors maintain another suite selection.

## 7. Should the candidate be packed or run from source?

Decision: A — Install the packed candidate.

Build and pack the proposed integration, then install its archive alongside exact peer artifacts. Tests import its consumer package name through published entrypoints.

Example:

```text
npm pack ./packages/react
install: candidate.tgz + atom.io@1.2.0
```

Tradeoff: Exercises packaging and consumer resolution; requires builds and a usable test harness around the archive.

Reasoning: This could be nice. Might be the best way.

## 8. Should representatives be derived or maintained?

Decision: neither alternative.

Reasoning: I think each era formulation for each peer could be given its own package.json and corresponding node_modules; this way the package and node_modules could simply be copied into the tmp environment where the test is done.

## 9. How much automatic sampling is enough?

Decision: neither alternative.

Reasoning: Only the actual versions identified, and only the representatives satisfying those versions actually present. If many representatives satisfy a version, so be it: test them all. If no representatives satisfy a version, that's an error

## 10. What defines an important support group?

Decision: A — Explicit semver alternatives.

Each declared || alternative is a coverage group. A representative may satisfy several groups; the planner explains that overlap and requires coverage for each alternative.

Example:

```text
"atom.io": "~1.2 || ^1.5 || ^2"
→ three required support groups
```

Tradeoff: No extra metadata; equivalent range rewrites can change the coverage obligation.

## 11. How should prereleases enter coverage?

Decision: A — Explicit preview enrollment.

Stable selection stays stable. A named preview policy or exact prerelease pin adds a separately labeled check, even when a support range permits that prerelease.

Example:

```text
"previewPeers": { "atom.io": "2.0.0-beta.1" }
→ separate preview result
```

Tradeoff: Predictable stable checks; maintainers must opt into previews they want to exercise.

Reasoning: Previews are special, and are typically expected to have breaking changes between sequential releases. A preview version may be enrolled as a unique alternative, but cannot, as a representative, satisfy anything but itself, 2.0.0-beta.1, for example, could not be said to satisfy "^2" for our purposes. That would be misleading.

## 12. Should evidence suggest a peer range?

Decision: neither alternative.

Reasoning: Test the representatives present for the declared era. A best practice would be to have an eldest and a newest representative, but you don't actually have to do this. For example, an author may opt to test only 19.4.1 for the whole "^19" era. That's their call. Or they may nominate multiple representatives.

## 13. What counts as a released peer artifact?

Decision: A — Registry artifacts are authoritative.

Install the exact published tarball with recorded integrity, including for packages that also exist locally. Missing registry artifacts fail setup rather than falling back to local source.

Example:

```text
atom.io@1.2.0 → registry tarball + integrity
Workspace source is never substituted.
```

Tradeoff: Direct evidence about consumer installations; private registries and credentials must be available.

Reasoning: I guess I lean this way, but my opinion isn't very strong on this.

## 14. How should several peers vary together?

Decision: neither alternative.

Reasoning: Representatives tell the story. Each representative is a complete manifest that defines the formulation of peers to be tested.

## 15. How much absence coverage is required?

Decision: neither alternative.

Reasoning: Interesting idea but we're not covering this yet. Maybe soon.

## 16. Must tests and candidate share one peer instance?

Decision: neither alternative.

Reasoning: The goal would be to be shared. Representative manifests should support this.

## 17. Should a setup failure stop other checks?

Decision: B — Collect independent results.

Continue environments that can still run and aggregate all outcomes. Any setup failure leaves the overall run failed and its required coverage incomplete.

Example:

```text
1.2.0: setup failed
1.4.0: passed
2.0.0: contract failed
Overall: setup failure with collected evidence
```

Tradeoff: A fuller diagnostic picture; outages can consume more execution time.

Reasoning: In CI you'd likely be running in a matrix, not sequentially, but for local testing I'd want it to be like this. And ideally to be parallelized.

## 18. Is a persisted plan required for every run?

Decision: neither alternative.

Reasoning: Not sure. My general thoughts are, 1. we may want to do a prelude for task-caching purposes 2. I don't want to check in a "plan"; that's what configs are for. So plan: no; prelude: maybe

## 19. What should Actions code generation produce?

Decision: neither alternative.

Reasoning: Changed my mind about this. Write your own matrix, we should have an API that makes this very concise and convenient in practice

## 20. When do new peer releases enter coverage?

Decision: neither alternative.

Reasoning: You can upgrade your representatives on your own schedule. Ideally with something like renovate. If you create a representative that's outside your declared ranges, that's a warning. If you don't have any representative for one of your declared ranges, that's an error.

## 21. What should one CI job own?

Decision: B — One exact environment.

Create a matrix job for each planned environment. Every result references the same plan; a required aggregation job rejects missing results and distinguishes contract from setup failures.

Example:

```text
Job: React + atom.io@1.2.0
Job: React + atom.io@1.4.0
Job: aggregate required environment IDs
```

Tradeoff: Parallel evidence and precise reruns; setup is repeated and aggregation is part of correctness.

Reasoning: Exactly, or "representative" as I've been calling it. "Peer environment" is pretty good term for this too

## 22. What should the first implementation prove?

Decision: A — Independent-release checking first.

Deliver the explicit npm boundary, one candidate integration, released local-peer representatives, isolation, verification, and useful reports. Add workflow generation after this contract is proven in atom.io.

Example:

```text
First proof: edited React integration
passes locally, fails against released atom.io
No Actions generator in the first release.
```

Tradeoff: A focused implementation and adoption test; automated CI matrix generation comes later.
