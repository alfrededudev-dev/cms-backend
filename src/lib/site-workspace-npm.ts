import { spawn } from "node:child_process"
import path from "node:path"

export async function runWorkspaceNpmScript(workspacePath: string, script: string) {
  const absoluteWorkspacePath = path.resolve(workspacePath)
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("npm", ["run", script], {
      cwd: absoluteWorkspacePath,
      shell: true,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      reject(error)
    })

    child.on("close", (code) => {
      const result = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }

      if (code === 0) {
        resolve(result)
        return
      }

      const error = new Error(result.stderr || result.stdout || `npm run ${script} failed with code ${code ?? "unknown"}`) as Error & {
        stdout?: string
        stderr?: string
      }
      error.stdout = result.stdout
      error.stderr = result.stderr
      reject(error)
    })
  })
}
