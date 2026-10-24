import { describe, expect, it } from "bun:test"

import type { BreakageOptions } from "../src/breakage.ts"

async function parseOptions(args: string[]): Promise<BreakageOptions> {
	const child = Bun.spawn(
		[
			process.execPath,
			`--preload`,
			`${import.meta.dir}/fixtures/capture-cli-options.ts`,
			`${import.meta.dir}/../src/breakage.x.ts`,
			`--testPattern=*__public.test.ts`,
			`--testCommand=bun test`,

			...args,
		],
		{ cwd: import.meta.dir, stdout: `pipe`, stderr: `pipe` },
	)
	const stderr = await new Response(child.stderr).text()
	expect(await child.exited).toBe(0)
	return JSON.parse(stderr)
}

describe(`breakage CLI short options`, () => {
	it(`enables verbose output without setting a release tag pattern`, async () => {
		const options = await parseOptions([`-v`])
		expect(options.verbose).toBe(true)
		expect(options.tagPattern).toBeUndefined()
	})

	it(`accepts a release tag pattern independently of verbose output`, async () => {
		const options = await parseOptions([`-g`, `my-library@`])
		expect(options.tagPattern).toBe(`my-library@`)
		expect(options.verbose).toBeUndefined()
	})

	it(`combines the tag pattern and verbose flags`, async () => {
		const options = await parseOptions([`-g`, `my-library@`, `-v`])
		expect(options.tagPattern).toBe(`my-library@`)
		expect(options.verbose).toBe(true)
	})

	it(`preserves the long tag pattern option`, async () => {
		const options = await parseOptions([`--tagPattern=my-library@`])
		expect(options.tagPattern).toBe(`my-library@`)
		expect(options.verbose).toBeUndefined()
	})
})
