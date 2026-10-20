import { render as renderWithHost } from "ranges-host"
export { renderer } from "renderer"
export const render = (text: string): string => renderWithHost(text)
