import "dotenv/config"
import { execSync } from "node:child_process"

const port = Number(process.env.PORT) || 3000

function getListeningPidOnPort(checkPort) {
  if (process.platform === "win32") {
    const output = execSync(`netstat -ano | findstr :${checkPort}`, { encoding: "utf8" })
    const line = output
      .split(/\r?\n/)
      .find((entry) => entry.includes("LISTENING") && entry.includes(`:${checkPort}`))

    if (!line) {
      return null
    }

    const pid = Number(line.trim().split(/\s+/).at(-1))
    return Number.isFinite(pid) ? pid : null
  }

  try {
    const output = execSync(`lsof -ti tcp:${checkPort} -sTCP:LISTEN`, { encoding: "utf8" }).trim()
    if (!output) {
      return null
    }

    const pid = Number(output.split(/\s+/)[0])
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

const pid = getListeningPidOnPort(port)

if (!pid) {
  console.log(`No process is listening on port ${port}.`)
  process.exit(0)
}

try {
  if (process.platform === "win32") {
    execSync(`taskkill /F /PID ${pid}`, { stdio: "inherit" })
  } else {
    execSync(`kill ${pid}`, { stdio: "inherit" })
  }

  console.log(`Stopped process ${pid} on port ${port}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to stop process")
  process.exit(1)
}
