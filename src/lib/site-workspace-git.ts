import fs from "node:fs/promises"
import path from "node:path"
import { createGitHubRepository } from "./github-api.js"
import { GitCommandError, runGitCommand } from "./git.js"

const DEFAULT_BRANCH = "main"
const DEFAULT_GIT_NAME = "CMS"
const DEFAULT_GIT_EMAIL = "cms@local"

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureLocalGitIdentity(workspacePath: string) {
  const { stdout: name } = await runGitCommand(workspacePath, ["config", "--get", "user.name"]).catch(() => ({
    stdout: "",
    stderr: "",
  }))

  if (!name.trim()) {
    await runGitCommand(workspacePath, ["config", "user.name", DEFAULT_GIT_NAME])
  }

  const { stdout: email } = await runGitCommand(workspacePath, ["config", "--get", "user.email"]).catch(() => ({
    stdout: "",
    stderr: "",
  }))

  if (!email.trim()) {
    await runGitCommand(workspacePath, ["config", "user.email", DEFAULT_GIT_EMAIL])
  }
}

async function getCurrentBranch(workspacePath: string) {
  try {
    const { stdout } = await runGitCommand(workspacePath, ["branch", "--show-current"])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function getRemoteUrl(workspacePath: string, remoteName = "origin") {
  try {
    const { stdout } = await runGitCommand(workspacePath, ["remote", "get-url", remoteName])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function hasCommits(workspacePath: string) {
  try {
    await runGitCommand(workspacePath, ["rev-parse", "HEAD"])
    return true
  } catch {
    return false
  }
}

function buildAuthedGitHubUrl(remoteUrl: string, token: string) {
  const parsed = new URL(remoteUrl)
  parsed.username = "x-access-token"
  parsed.password = token
  return parsed.toString()
}

export async function getSiteWorkspaceGitStatus(workspacePath: string) {
  const initialized = await pathExists(path.join(workspacePath, ".git"))

  if (!initialized) {
    return {
      initialized: false as const,
      branch: null,
      remoteUrl: null,
      hasCommits: false,
      clean: true,
      statusText: "Git repository is not initialized.",
      porcelain: "",
    }
  }

  const branch = await getCurrentBranch(workspacePath)
  const remoteUrl = await getRemoteUrl(workspacePath)
  const commitsExist = await hasCommits(workspacePath)
  const { stdout: porcelain } = await runGitCommand(workspacePath, ["status", "--porcelain"]).catch(() => ({
    stdout: "",
    stderr: "",
  }))
  const { stdout: statusText } = await runGitCommand(workspacePath, ["status"]).catch((error) => {
    if (error instanceof GitCommandError) {
      return { stdout: error.stdout || error.message, stderr: error.stderr }
    }

    throw error
  })

  return {
    initialized: true as const,
    branch,
    remoteUrl,
    hasCommits: commitsExist,
    clean: porcelain.trim().length === 0,
    statusText,
    porcelain,
  }
}

export async function initSiteWorkspaceGit(workspacePath: string) {
  if (await pathExists(path.join(workspacePath, ".git"))) {
    throw new Error("Git repository is already initialized")
  }

  try {
    await runGitCommand(workspacePath, ["init", "-b", DEFAULT_BRANCH])
  } catch {
    await runGitCommand(workspacePath, ["init"])
    await runGitCommand(workspacePath, ["branch", "-M", DEFAULT_BRANCH]).catch(() => {})
  }

  await ensureLocalGitIdentity(workspacePath)

  return getSiteWorkspaceGitStatus(workspacePath)
}

export async function ensureMainBranch(workspacePath: string) {
  const branch = await getCurrentBranch(workspacePath)

  if (branch === "master") {
    await runGitCommand(workspacePath, ["branch", "-M", DEFAULT_BRANCH])
    return DEFAULT_BRANCH
  }

  if (!branch) {
    await runGitCommand(workspacePath, ["branch", "-M", DEFAULT_BRANCH]).catch(() => {})
    return DEFAULT_BRANCH
  }

  return branch
}

export async function connectSiteWorkspaceToGitHub(input: {
  workspacePath: string
  token: string
  repoName: string
  private?: boolean
  description?: string
  owner?: string
}) {
  if (!(await pathExists(path.join(input.workspacePath, ".git")))) {
    throw new Error("Initialize git before creating a GitHub repository")
  }

  const repository = await createGitHubRepository({
    token: input.token,
    name: input.repoName,
    private: input.private,
    description: input.description,
    owner: input.owner,
  })

  const branch = await ensureMainBranch(input.workspacePath)

  const existingRemote = await getRemoteUrl(input.workspacePath)
  if (existingRemote) {
    await runGitCommand(input.workspacePath, ["remote", "remove", "origin"])
  }

  await runGitCommand(input.workspacePath, ["remote", "add", "origin", repository.cloneUrl])

  return {
    branch,
    remoteUrl: repository.cloneUrl,
    htmlUrl: repository.htmlUrl,
    fullName: repository.fullName,
    status: await getSiteWorkspaceGitStatus(input.workspacePath),
  }
}

export async function commitSiteWorkspaceGit(workspacePath: string, message: string) {
  if (!(await pathExists(path.join(workspacePath, ".git")))) {
    throw new Error("Initialize git before creating a commit")
  }

  const trimmedMessage = message.trim()
  if (!trimmedMessage) {
    throw new Error("Commit message is required")
  }

  await ensureLocalGitIdentity(workspacePath)
  await runGitCommand(workspacePath, ["add", "-A"])

  const { stdout: porcelain } = await runGitCommand(workspacePath, ["status", "--porcelain"])
  if (!porcelain.trim()) {
    throw new Error("Nothing to commit")
  }

  await runGitCommand(workspacePath, ["commit", "-m", trimmedMessage])

  return getSiteWorkspaceGitStatus(workspacePath)
}

export async function pushSiteWorkspaceGit(input: {
  workspacePath: string
  token: string
  branch?: string
  remoteUrl?: string | null
}) {
  if (!(await pathExists(path.join(input.workspacePath, ".git")))) {
    throw new Error("Initialize git before pushing")
  }

  const branch = input.branch?.trim() || (await ensureMainBranch(input.workspacePath))
  const remoteUrl = input.remoteUrl?.trim() || (await getRemoteUrl(input.workspacePath))

  if (!remoteUrl) {
    throw new Error("Remote origin is not configured")
  }

  if (!(await hasCommits(input.workspacePath))) {
    throw new Error("Create a commit before pushing")
  }

  const authedUrl = buildAuthedGitHubUrl(remoteUrl, input.token)
  await runGitCommand(input.workspacePath, ["push", "-u", authedUrl, branch])

  return getSiteWorkspaceGitStatus(input.workspacePath)
}
