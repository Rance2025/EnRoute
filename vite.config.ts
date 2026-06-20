import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

loadLocalEnv()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.ENROUTE_API_PORT ?? '5178'}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/output/**',
      '**/test-results/**',
    ],
  },
})

function loadLocalEnv(envPath = '.env.local') {
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

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
