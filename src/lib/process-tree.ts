import { spawn, type ChildProcess } from "node:child_process"

export function killDevProcessTree(devProcess: ChildProcess): Promise<void> {
  if (!devProcess.pid) {
    devProcess.kill()
    return Promise.resolve()
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(devProcess.pid), "/T", "/F"], {
        shell: true,
        windowsHide: true,
        stdio: "ignore",
      })

      killer.on("close", () => resolve())
      killer.on("error", () => resolve())
    })
  }

  devProcess.kill("SIGTERM")

  return new Promise((resolve) => {
    devProcess.once("close", () => resolve())
    setTimeout(resolve, 2000)
  })
}
