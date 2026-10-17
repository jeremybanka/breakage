import { expect, it } from "bun:test"

import { resolvePeerPins } from "../src/peer-pins.ts"

const support = {
	ranges: { react: `17.3.3 || ~18.4 || ^18.6 || >=19` },
	optional: [],
	devDependencies: {
		"react_v17.3.3": `npm:react@17.3.3`,
		"react_v18.4.x": `npm:react@18.4.1`,
		"react_v18.6-or-greater-18.x": `npm:react@18.7.3`,
		"react_v19-or-greater": `npm:react@19.2.1`,
	},
}

it(`validates arbitrary support groups using exact aliases without parsing descriptive labels`, () => {
	const pins = resolvePeerPins(support).react!
	expect(pins.map((pin) => pin.groups)).toEqual([
		[`17.3.3`],
		[`~18.4`],
		[`^18.6`],
		[`>=19`],
	])
	const updated = resolvePeerPins({
		...support,
		devDependencies: {
			...support.devDependencies,
			"react_v19-or-greater": `npm:react@20.0.1`,
		},
	})
	expect(updated.react!.at(-1)).toEqual({
		alias: `react_v19-or-greater`,
		version: `20.0.1`,
		groups: [`>=19`],
	})
})

it(`preserves overlapping groups, scoped names, zero versions, and explicit prerelease support`, () => {
	const pins = resolvePeerPins({
		ranges: { "@scope/host": `0.2.1 - 0.3.4 || >=0.3.0 <0.4 || ^1.0.0-beta.1` },
		optional: [],
		devDependencies: {
			"@scope/host_v0_zero": `npm:@scope/host@0.3.4`,
			"@scope/host_v1_beta": `npm:@scope/host@1.0.0-beta.2`,
		},
	})
	expect(pins[`@scope/host`]![0]!.groups).toEqual([
		`0.2.1 - 0.3.4`,
		`>=0.3.0 <0.4`,
	])
	expect(pins[`@scope/host`]![1]!.version).toBe(`1.0.0-beta.2`)
})

it.each([
	[`npm:react@^19`, `pin an exact version`],
	[`npm:react@latest`, `pin an exact version`],
	[`npm:other@19.2.1`, `must target peer react`],
	[`19.2.1`, `expected npm:react@<exact-version>`],
	[`npm:react@18.5.0`, `outside peerDependencies`],
	[`npm:react@20.0.0-beta.1`, `outside peerDependencies`],
])(
	`diagnoses invalid pin %s with its manifest location`,
	(specifier, message) => {
		const run = () =>
			resolvePeerPins({
				...support,
				devDependencies: {
					...support.devDependencies,
					"react_v19-or-greater": specifier,
				},
			})
		expect(run).toThrow(`devDependencies["react_v19-or-greater"]`)
		expect(run).toThrow(message)
		expect(run).toThrow(`no pinned development alias satisfying group ">=19"`)
	},
)

it(`reports every uncovered group and rejects missing delimiters and undeclared targets`, () => {
	expect(() => resolvePeerPins({ ...support, devDependencies: {} })).toThrow(
		`group "~18.4"`,
	)
	expect(() =>
		resolvePeerPins({ ...support, ranges: { react: `17 | 18` } }),
	).toThrow(`Separate alternatives with ||`)
	expect(() =>
		resolvePeerPins({
			...support,
			devDependencies: {
				...support.devDependencies,
				react19: `npm:react@19.2.1`,
			},
		}),
	).toThrow(`name must be react_v<label>`)
	expect(() =>
		resolvePeerPins({
			ranges: {},
			optional: [],
			devDependencies: { host_v1: `npm:host@1.0.0` },
		}),
	).toThrow(`undeclared peer host`)
})
