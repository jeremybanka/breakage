# npm compatibility decisions

The eight follow-up questions are resolved by the [completed answers](./npm-compatibility-followup-decisions.md) and [accepted specification](./npm-compatibility-spec.md). The later in-place execution decision supersedes reconstructing the representative in a temporary directory: use its frozen inputs and local installation, and stage disposable contracts, fixtures, and candidates under its ignored `test/` directory.

Implementation choices are recorded in the specification: preserve JSON while adding TypeScript, use packed candidates, delegate frozen installation to repository commands, verify physical peer identity without claiming registry attestation, and leave breaking-release policy to an explicit callback informed by the intended version and release delta. There are no remaining design blockers for this implementation.
