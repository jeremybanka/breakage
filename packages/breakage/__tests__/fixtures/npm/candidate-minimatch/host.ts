import minimatch from "minimatch"

export { minimatch as matcher }
export const matches = (filename: string): boolean =>
	minimatch(filename, `**/*.ts`)
