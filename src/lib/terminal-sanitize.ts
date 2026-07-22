/** Remove ANSI color/formatting codes from CLI output (Astro, Vite, npm). */
export function stripAnsi(value: string) {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-9;]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[@-Z\\-_]/g, "")
    .replace(/\u009B[0-9;]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
}

export function sanitizeTerminalOutput(value: string) {
  return stripAnsi(value).replace(/\u0000/g, "")
}

export const plainTerminalEnv = {
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  npm_config_color: "false",
} as const
