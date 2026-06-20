import { spawnSync } from 'node:child_process'

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--run')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(
  npmCommand,
  ['--workspace', 'apps/web', 'exec', 'vitest', '--', '--run', ...forwardedArgs],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
