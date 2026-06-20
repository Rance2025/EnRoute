// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { createDevCommands } from './dev-with-api.mjs'

const execFileAsync = promisify(execFile)

describe('dev-with-api helpers', () => {
  it('starts Vite directly so shutdown controls the frontend process instead of an npm wrapper', () => {
    expect(createDevCommands()).toEqual([
      {
        name: 'api',
        command: process.execPath,
        args: ['server/dev-server.mjs'],
      },
      {
        name: 'vite',
        command: process.execPath,
        args: [
          expect.stringContaining('vite'),
          '--host',
          '127.0.0.1',
          '--port',
          '5173',
        ],
      },
    ])
  })

  it('can execute the script entrypoint after initializing command helpers', async () => {
    await expect(
      execFileAsync(process.execPath, ['scripts/dev-with-api.mjs', '--print-dev-commands']),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining('"name":"vite"'),
      stderr: '',
    })
  })
})
