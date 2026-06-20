import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadLocalEnv(envPath = '.env.local') {
  const resolvedEnvPath = resolve(envPath)
  if (!existsSync(resolvedEnvPath)) return

  for (const line of readFileSync(resolvedEnvPath, 'utf8').split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue

    const separatorIndex = trimmedLine.indexOf('=')
    if (separatorIndex < 1) continue

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const value = unquoteEnvValue(trimmedLine.slice(separatorIndex + 1).trim())

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
