import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export class GitCommandError extends Error {
  stdout: string
  stderr: string

  constructor(message: string, stdout: string, stderr: string) {
    super(message)
    this.name = "GitCommandError"
    this.stdout = stdout
    this.stderr = stderr
  }
}

export async function runGitCommand(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: 10 * 1024 * 1024,
    })

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const stdout = execError.stdout?.toString().trim() ?? ""
    const stderr = execError.stderr?.toString().trim() ?? ""
    const message = stderr || stdout || execError.message || "Git command failed"

    throw new GitCommandError(message, stdout, stderr)
  }
}

export async function cloneGitRepository(input: {
  gitUrl: string
  branch: string
  targetPath: string
}) {
  await fs.rm(input.targetPath, { recursive: true, force: true })
  await fs.mkdir(path.dirname(input.targetPath), { recursive: true })

  await execFileAsync(
    "git",
    ["clone", "--depth", "1", "--branch", input.branch, input.gitUrl, input.targetPath],
    { windowsHide: true },
  )

  await fs.rm(path.join(input.targetPath, ".git"), { recursive: true, force: true })
}
