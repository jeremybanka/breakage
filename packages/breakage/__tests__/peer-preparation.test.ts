import { rejects } from "node:assert/strict"
import { mkdir, readFile, realpath, symlink } from "node:fs/promises"
import path from "node:path"

import { expect, it } from "bun:test"

import { breakage } from "../src/breakage.ts"
import { peerProject } from "./peer-project.ts"

it(`prepares and builds with Bun and pinned Git sources while pnpm is unavailable`, async () => {
	const project = await peerProject(
		{
			prepareCommand: `bun prepare.ts`,
			embassies: {
				host: {
					testPattern: `public/**/*`,
					testCommand: `bun test ./public/contract.ts`,
				},
			},
		},
		`import { expect, test } from "bun:test"; import { value } from "fixture-plugin"; test("current integration", () => expect(value).toBe("current:" + JSON.parse(process.env.BREAKAGE_PEERS).host));`,
	)
	try {
		await project.write(`.gitignore`, `.breakage/\nnode_modules/\ndist/\n`)
		await project.write(
			`package.json`,
			JSON.stringify({
				name: `fixture-plugin`,
				version: `1.0.0`,
				type: `module`,
				exports: `./dist/index.js`,
				packageManager: `bun@1.4.3`,
				workspaces: [`packages/*`, `!packages/excluded`],
				peerDependencies: { host: `1.0.0 || ^2` },
				devDependencies: {
					host_v1: `npm:host@1.0.0`,
					host_v2: `npm:host@2.0.0`,
				},
			}),
		)
		await project.write(
			`packages/excluded/package.json`,
			JSON.stringify({ name: `host`, version: `99.0.0` }),
		)
		for (const version of [`1.0.0`, `2.0.0`]) {
			await project.write(
				`packages/host/package.json`,
				JSON.stringify({
					name: `host`,
					version,
					type: `module`,
					exports: `./index.ts`,
				}),
			)
			await project.write(
				`packages/host/index.ts`,
				`export const value = "${version}";`,
			)
			await project.git
				.add(`.`)
				.commit(`Host ${version}`)
				.addTag(`host@${version}`)
		}
		await project.write(
			`packages/host/index.ts`,
			`throw new Error("current workspace peer leaked");`,
		)
		await project.write(
			`src/index.ts`,
			`import { value as host } from "host"; export const value = "current:" + host;`,
		)
		await project.write(
			`prepare.ts`,
			`import assert from "node:assert/strict";
const plan = await Bun.file(process.env.BREAKAGE_PREPARATION).json();
assert.equal(Bun.which("pnpm"), null, "pnpm must be unavailable");
const manifest = await Bun.file("package.json").json();
assert.equal(manifest.packageManager, "bun@1.4.3", "breakage must preserve the repository manifest");
assert.equal(plan.sources.host.kind, "workspace");
const candidateGit = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
const peerGit = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: plan.sources.host.root });
assert.equal(candidateGit.stdout.toString(), peerGit.stdout.toString());
delete manifest.workspaces;
delete manifest.devDependencies;
delete manifest.peerDependencies;
manifest.dependencies = { host: "file:" + plan.sources.host.directory };
await Bun.write("package.json", JSON.stringify(manifest));
const install = Bun.spawnSync(["bun", "install", "--offline", "--ignore-scripts", "--no-progress"], { stdout: "pipe", stderr: "pipe" });
assert.equal(install.exitCode, 0, install.stderr.toString());
const build = await Bun.build({ entrypoints: ["src/index.ts"], outdir: "dist", target: "bun", external: ["host"] });
assert.equal(build.success, true);
`,
		)
		await project.git.add(`.`).commit(`Build current candidate with Bun`)
		const originalManifest = await readFile(
			path.join(project.repository, `package.json`),
			`utf8`,
		)
		const registrations = await project.git.raw([
			`worktree`,
			`list`,
			`--porcelain`,
		])
		const executables = path.join(project.directory, `executables`)
		await mkdir(executables)
		for (const name of [`git`, `bun`, `node`]) {
			const executable = Bun.which(name)
			if (!executable) throw new Error(`Missing ${name} for fixture`)
			await symlink(await realpath(executable), path.join(executables, name))
		}
		const cli = path.resolve(
			process.env.BREAKAGE_CLI_ENTRYPOINT ??
				`packages/breakage/src/breakage.x.ts`,
		)
		const run = (...args: string[]) =>
			Bun.spawnSync([path.join(executables, `bun`), cli, `--`, ...args], {
				cwd: project.repository,
				env: { ...process.env, PATH: executables },
			})
		const prelude = run(`prelude`, `--out=.breakage/baseline.json`)
		expect(prelude.stderr.toString()).toBe(``)
		expect(prelude.exitCode).toBe(0)
		const baseline = JSON.parse(
			await readFile(
				path.join(project.repository, `.breakage/baseline.json`),
				`utf8`,
			),
		)
		expect(baseline.peers.packageManager).toBeUndefined()
		expect(baseline.peers.sources[`host@1.0.0`].kind).toBe(`workspace`)
		await project.git.removeRemote(`origin`)
		await project.git.tag([`-d`, `host@1.0.0`, `host@2.0.0`])
		const check = run(`--baseline-file=.breakage/baseline.json`)
		expect(check.stderr.toString()).toBe(``)
		const report = JSON.parse(check.stdout.toString())
		expect(report).toMatchObject({
			success: true,
			peerResults: [{ status: `passed` }, { status: `passed` }],
		})
		expect(check.exitCode).toBe(0)
		expect(
			await readFile(path.join(project.repository, `package.json`), `utf8`),
		).toBe(originalManifest)
		expect(await project.git.raw([`worktree`, `list`, `--porcelain`])).toBe(
			registrations,
		)
		expect((await project.git.status()).isClean()).toBe(true)
	} finally {
		await project.cleanup()
	}
}, 30000)

it(`keeps preparation errors as setup failures and cleans every worktree`, async () => {
	const project = await peerProject(
		{ prepareCommand: `"${process.execPath}" fail.ts` },
		`throw new Error("contract must not run");`,
	)
	try {
		await project.write(
			`fail.ts`,
			`const plan = await Bun.file(process.env.BREAKAGE_PREPARATION).json(); await Bun.write(plan.resultFile, JSON.stringify({ status: "incompatible", reason: "must not hide the failed build" })); console.error("build failed"); process.exit(1);`,
		)
		await project.git.add(`.`).commit(`Fail preparation`)
		const registrations = await project.git.raw([
			`worktree`,
			`list`,
			`--porcelain`,
		])
		expect(await breakage(project.options)).toMatchObject({
			success: false,
			excludedEnvironments: [],
			peerResults: [
				{ status: `setup-failed`, stderr: `build failed\n` },
				{ status: `setup-failed`, stderr: `build failed\n` },
			],
		})
		expect(await project.git.raw([`worktree`, `list`, `--porcelain`])).toBe(
			registrations,
		)
	} finally {
		await project.cleanup()
	}
})

it(`rejects custom incompatibility reports that leave a pin uncovered before running tests`, async () => {
	const project = await peerProject(
		{ prepareCommand: `"${process.execPath}" exclude.ts` },
		`throw new Error("contract must not run");`,
	)
	try {
		await project.write(
			`exclude.ts`,
			`const plan = await Bun.file(process.env.BREAKAGE_PREPARATION).json(); await Bun.write(plan.resultFile, JSON.stringify({ status: "incompatible", reason: "unsupported peer combination" }));`,
		)
		await project.git.add(`.`).commit(`Reject all combinations`)
		const registrations = await project.git.raw([
			`worktree`,
			`list`,
			`--porcelain`,
		])
		await rejects(breakage(project.options), /has no compatible environment/)
		expect(await project.git.raw([`worktree`, `list`, `--porcelain`])).toBe(
			registrations,
		)
	} finally {
		await project.cleanup()
	}
})

it(`verifies custom preparation instead of trusting a successful command`, async () => {
	const project = await peerProject({})
	try {
		await project.write(
			`fixture-prepare.ts`,
			`import { mkdir, writeFile } from "node:fs/promises"; await mkdir("node_modules/host", { recursive: true }); await writeFile("node_modules/host/package.json", JSON.stringify({ name: "host", version: "9.0.0", main: "index.ts" })); await writeFile("node_modules/host/index.ts", "export const value = true;");`,
		)
		await project.git.add(`.`).commit(`Prepare the wrong peer`)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			success: false,
			peerResults: [{ status: `setup-failed` }, { status: `setup-failed` }],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing report`)
		expect(result.peerResults[0]!.stderr).toContain(
			`did not resolve to the selected version 1.0.0`,
		)
	} finally {
		await project.cleanup()
	}
})

it(`rechecks runtime-specific resolution after an embassy changes its peer`, async () => {
	const project = await peerProject(
		{ verifyCommand: `"${process.execPath}" verify.ts` },
		`const manifest = await Bun.file("node_modules/host/package.json").json(); manifest.version = "9.0.0"; await Bun.write("node_modules/host/package.json", JSON.stringify(manifest));`,
	)
	try {
		await project.write(
			`verify.ts`,
			`import path from "node:path";
const plan = await Bun.file(process.env.BREAKAGE_PREPARATION).json();
const describe = async (directory) => {
 const filename = Bun.resolveSync("host/package.json", directory);
 const manifest = await Bun.file(filename).json();
 return { name: manifest.name, version: manifest.version, identity: path.dirname(filename) };
};
await Bun.write(plan.verifyFile, JSON.stringify({ host: { tests: await describe(process.cwd()), candidate: await describe(plan.candidate.directory) } }));`,
		)
		await project.git.add(`.`).commit(`Check Bun resolution after tests`)
		const result = await breakage(project.options)
		expect(result).toMatchObject({
			success: false,
			peerResults: [{ status: `setup-failed` }, { status: `setup-failed` }],
		})
		if (!(`peerResults` in result)) throw new Error(`Missing report`)
		expect(result.peerResults[0]!.stderr).toContain(
			`did not resolve to the selected version 1.0.0`,
		)
	} finally {
		await project.cleanup()
	}
})

it(`checks optional absence with repository preparation`, async () => {
	const project = await peerProject(
		{},
		`import assert from "node:assert/strict";
const version = JSON.parse(process.env.BREAKAGE_PEERS).host;
if (version === null) assert.equal(await Bun.file("node_modules/host/package.json").exists(), false);
else assert.equal((await Bun.file("node_modules/host/package.json").json()).version, version);`,
	)
	try {
		const manifest = JSON.parse(
			await readFile(path.join(project.repository, `package.json`), `utf8`),
		)
		manifest.peerDependenciesMeta = { host: { optional: true } }
		await project.write(`package.json`, JSON.stringify(manifest))
		await project.git.add(`.`).commit(`Support optional host absence`)
		expect(await breakage(project.options)).toMatchObject({
			success: true,
			peerResults: [
				{ peers: { host: `1.0.0` }, status: `passed` },
				{ peers: { host: `1.1.0` }, status: `passed` },
				{ peers: { host: null }, status: `passed` },
			],
		})
	} finally {
		await project.cleanup()
	}
})
