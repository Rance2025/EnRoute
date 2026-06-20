// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { createDevCommands } from './dev-with-api.mjs'

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
})
