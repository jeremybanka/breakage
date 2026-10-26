import type { BreakageConfig } from "breakage"

const config: BreakageConfig = {
	npmMatrix: {
		configs: [`data.config.ts`],
		prepare: `node prepare-matrix.ts`,
		label: ({ packageName, description, representative }) =>
			`${packageName}: ${description ?? representative}`,
	},
}
export default config
