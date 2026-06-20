import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

if (isMainModule()) {
  if (process.argv.includes('--print-dev-commands')) {
    process.stdout.write(`${JSON.stringify(createDevCommands())}\n`)
  } else {
    runDevWithApi()
  }
}

export function createDevCommands() {
  const viteBinPath = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

  return [
    {
      name: 'api',
      command: process.execPath,
      args: ['server/dev-server.mjs'],
    },
    {
      name: 'vite',
      command: process.execPath,
      args: [viteBinPath, '--host', '127.0.0.1', '--port', '5173'],
    },
  ]
}

function runDevWithApi() {
  let shuttingDown = false
  const commands = createDevCommands()
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
