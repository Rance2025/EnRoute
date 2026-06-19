import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('external/backUpData-all.csv')
const target = resolve('public/local/backUpData-all.csv')

await stat(source)
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)

console.log(`Copied ${source} to ${target}`)
