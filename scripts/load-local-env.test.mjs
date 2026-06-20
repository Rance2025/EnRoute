// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadLocalEnv } from './load-local-env.mjs'

const tempDirs = []

afterEach(async () => {
  delete process.env.ENROUTE_TEST_ENV
  delete process.env.ENROUTE_TEST_QUOTED
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('loadLocalEnv', () => {
  it('loads key value pairs without overriding existing process env', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'enroute-env-'))
    tempDirs.push(directory)
    const envPath = join(directory, '.env.local')
    process.env.ENROUTE_TEST_ENV = 'existing'
    await writeFile(
      envPath,
      [
        '# ignored',
        'ENROUTE_TEST_ENV=from-file',
        'ENROUTE_TEST_QUOTED="quoted value"',
      ].join('\n'),
      'utf8',
    )

    loadLocalEnv(envPath)

    expect(process.env.ENROUTE_TEST_ENV).toBe('existing')
    expect(process.env.ENROUTE_TEST_QUOTED).toBe('quoted value')
  })
})
