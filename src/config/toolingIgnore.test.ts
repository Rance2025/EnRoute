import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const eslintConfig = readFileSync('eslint.config.js', 'utf8')
const viteConfig = readFileSync('vite.config.ts', 'utf8')

const ignoredToolingDirectories = ['dist', '.worktrees', 'output', 'test-results']

describe('tooling ignore rules', () => {
  it('keeps local tooling output outside ESLint scans', () => {
    for (const directory of ignoredToolingDirectories) {
      expect(eslintConfig).toContain(`'${directory}'`)
    }
  })

  it('keeps local tooling output outside Vitest discovery', () => {
    for (const directory of ignoredToolingDirectories) {
      expect(viteConfig).toContain(`'**/${directory}/**'`)
    }
  })
})
