// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { getNpmCommand } from './dev-with-api.mjs'

describe('dev-with-api helpers', () => {
  it('uses the active Node executable and npm CLI on Windows when npm_execpath is available', () => {
    expect(
      getNpmCommand('win32', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'),
    ).toEqual({
      command: process.execPath,
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
    })
  })

  it('uses npm directly on non-Windows platforms', () => {
    expect(getNpmCommand('linux')).toEqual({ command: 'npm', args: [] })
  })
})
