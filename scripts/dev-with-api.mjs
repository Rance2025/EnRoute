import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (isMainModule()) {
  runDevWithApi()
}

export function getNpmCommand(platform, npmExecPath = process.env.npm_execpath) {
  return platform === 'win32' && npmExecPath
    ? { command: process.execPath, args: [npmExecPath] }
    : { command: 'npm', args: [] }
}

function runDevWithApi() {
  const npmCommand = getNpmCommand(process.platform)
  const commands = [
    {
      name: 'api',
      command: 'node',
      args: ['server/dev-server.mjs'],
    },
    {
      name: 'vite',
      command: npmCommand.command,
      args: [...npmCommand.args, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'],
    },
  ]

  let shuttingDown = false
  const children = commands.map(({ name, command, args }) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    pipeChildOutput(name, child.stdout, process.stdout)
    pipeChildOutput(name, child.stderr, process.stderr)

    child.on('exit', (code, signal) => {
      if (shuttingDown) return
      shuttingDown = true
      stopChildren(children)
      if (signal) process.kill(process.pid, signal)
      else process.exit(code ?? 0)
    })

    child.on('error', (error) => {
      console.error(`[${name}] ${error.message}`)
    })

    return child
  })

  process.on('SIGINT', () => {
    shuttingDown = true
    stopChildren(children)
  })

  process.on('SIGTERM', () => {
    shuttingDown = true
    stopChildren(children)
  })
}

function stopChildren(children) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
}

function pipeChildOutput(name, stream, target) {
  stream?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line) target.write(`[${name}] ${line}\n`)
    }
  })
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url)
}
