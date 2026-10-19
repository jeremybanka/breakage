# Breakage npm follow-up decisions

Deck version: 1. Completed: 8 of 8.

These answers refine the npm specification after the completed first-round decisions. Example commands and configuration are proposals, not released APIs.

## 1. What should release certification establish?

Decision: A — Return the intended release.

Ask the hook about a peer. It reports either no release or an exact intended version, with failure to inspect intent treated as a setup error. Breakage checks that version against the integration's requirements and records the evidence.

Example:

```text
releaseIntent({ peer: "atom.io" })
→ { status: "release", version: "2.0.0" }
→ { status: "none" }
Inspection failure → setup error
```

Tradeoff: The hook supplies version knowledge once; it needs a small structured result contract.

Reasoning: This is more correct, but whether the release delta is patch, minor, or major is also potentially relevant.

## 2. Where does a coordinated peer candidate belong?

Decision: A — An explicitly candidate-capable representative.

Register a complete environment that names which local peers it expects as candidates. After certification, install their packed artifacts at the intended versions there. This environment supplies conditional evidence for its actual installed formulation, including a new era.

Example:

```text
Representative: environments/react-next
Candidate peer: atom.io → certified 2.0.0
Other peers: exactly as this manifest defines
Result: conditional on atom.io@2.0.0 publishing
```

Tradeoff: Every candidate formulation is explicit and independently runnable; maintainers register candidate environments alongside released ones.

Reasoning: Right. I think there's a related concern you're pointing at here which is: "It's a form of breakage to drop support for a certain era!" That's true. This is actually a third thing that lives at the intersection of peer compatibility and public contracts. To lay it out unambiguously: - Public breakage: Parts of the declared public contract changed or regressed in this new candidate. (Solution: get tests passing or certify with intent to release a breaking-change version) - Compatibility breakage: This candidate fails with one of its officially named compatibility eras with peer X. (Solution: get tests passing with your representatives for this era, or remove the era from your declared support) - End of Support Breakage: This candidate removes support for an era supported in the previous version. (Solution: restore that era to the list, or certify your intent to make a breaking-change release)

## 3. How should configuration express peer-aware logic?

Decision: A — Optional TypeScript configuration.

Add breakage.config.ts as an optional configuration format for the CLI, while retaining JSON. Peer-aware npm hooks are ordinary typed functions that can call Changesets or repository helpers. The npm implementation validates returned release evidence.

Example:

```text
export default {
  npm: {
    releaseIntent: async ({ peer }) => inspectRelease(peer)
  }
}
```

Tradeoff: Natural parameterization and reusable repository code; loading executable configuration needs a clearly defined runtime and precedence.

Reasoning: Possibly only support this. Comline is good at handling it.

## 4. How are complete representatives discovered?

Decision: A — Discover directories and infer membership.

Configure a directory glob. Inspect each representative's installed peer versions, validate them against its manifest and any lock file, and infer the declared eras it covers. Configured peer suites determine which tests apply; labels are just paths.

Example:

```text
representatives: "peer-environments/*"
react-modern/package.json + node_modules
→ installed React 19.4.1 covers declared ^19
Stale or inconsistent installed state → setup error
```

Tradeoff: Little repeated metadata; suite membership and coverage need an informative discovery report.

## 5. How should a representative become an isolated test?

Decision: B — Recreate from frozen installation inputs.

Treat the representative's installed versions as the expected formulation, but reproduce it using its manifest, lock file, and repository-configured frozen installation command. Repository preparation supplies the built candidate archive. Reject any difference from the expected peer versions or any workspace-source leak.

Example:

```text
representative manifest + lock → isolated frozen install
repository preparation → candidate.tgz
expected installed peers === observed isolated peers
Tests and candidate resolve the same peer instances.
```

Tradeoff: Delegates layout handling to the package manager; requires reproducible installation inputs and may need cache or network access.

Reasoning: Rationale: Keep It Simple Stupid.

## 6. Who checks that the manual CI matrix is complete?

Decision: A — Configuration audit plus workflow ownership.

An audit validates that configured representatives cover every era. Focused test commands execute the requested matches or named environment and fail when none match. The developer's workflow enumerates those jobs and makes their success required; Breakage does not collect cross-job receipts.

Example:

```text
breakage npm check --coverage-only
breakage npm test react 18
breakage npm test --representative modern
CI owns the complete list of required jobs.
```

Tradeoff: A small composable API without workflow machinery; authors must keep job coverage aligned with the configured fixtures.

Reasoning: This is BYO but probably GHA matrix coordinations, dependent jobs, etc.

## 7. Does npm checking need its own optional prelude?

Decision: A — Document a task-input contract first.

Start with a one-command check. Document the candidate, representative installation, configuration, and release-intent inputs a task cache must include. A repository that cannot identify all relevant inputs runs the npm check uncached; add a dedicated prelude only after that proves insufficient.

Example:

```text
breakage npm check
Cache inputs: candidate + fixtures + installation evidence
  + configuration + release-intent inputs
Unknown dynamic input → disable caching for this task
```

Tradeoff: The smallest initial command surface; cache correctness is a repository responsibility until a standard prelude exists.

## 8. How strong must released-peer provenance be?

Decision: neither alternative.

Reasoning: No strong opinion about this.
