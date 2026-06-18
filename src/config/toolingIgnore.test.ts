import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const eslintConfig = readFileSync('eslint.config.js', 'utf8')

describe('tooling ignore rules', () => {
  it('keeps ignored local worktrees outside ESLint scans', () => {
    expect(eslintConfig).toContain("globalIgnores(['dist', '.worktrees'])")
  })
})
