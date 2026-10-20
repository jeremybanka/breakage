import { render as renderWithHost } from "ranges-host"
export { renderer } from "ranges-host"
export const render = (text: string): string => renderWithHost(text)
