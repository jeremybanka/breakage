import config from "./data.config.ts"

const suite = config.npm.suites.host
if (suite && process.env.BREAKAGE_MATRIX_COMMAND)
	suite.command = process.env.BREAKAGE_MATRIX_COMMAND
export default config
