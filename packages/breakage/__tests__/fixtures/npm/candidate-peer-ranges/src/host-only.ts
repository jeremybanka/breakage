import { render as renderWithHost } from "host"
export { renderer } from "host"
export const render = (text: string): string => renderWithHost(text)
