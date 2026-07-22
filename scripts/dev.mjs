import dotenv from "dotenv"
import { spawn } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(scriptDir, "..")

dotenv.config({ path: path.join(backendRoot, ".env") })

const port = Number(process.env.PORT) || 3000

async function isCmsRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json()
    return data?.status === "ok"
  } catch {
    return false
  }
}

function isPortInUse(checkPort) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once("error", () => resolve(true))
    server.once("listening", () => {
      server.close()
      resolve(false)
    })

    server.listen(checkPort, "127.0.0.1")
  })
}

if (await isCmsRunning()) {
  console.log(`CMS API is already running on http://localhost:${port}`)
  console.log("No need to start another server — tsx watch reloads code in the existing terminal.")
  console.log("To restart: npm run dev:stop && npm run dev")
  process.exit(0)
}

if (await isPortInUse(port)) {
  console.error(`Port ${port} is already in use by another application.`)
  console.error(`Free the port or set a different PORT in backend/.env, then run npm run dev again.`)
  process.exit(1)
}

const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs")

const child = spawn(process.execPath, [tsxCli, "watch", "src/index.ts"], {
  cwd: backendRoot,
  stdio: "inherit",
  env: process.env,
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})

process.on("SIGINT", () => {
  child.kill("SIGINT")
})

process.on("SIGTERM", () => {
  child.kill("SIGTERM")
})
