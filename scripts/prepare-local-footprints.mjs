import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('external/backUpData-all.csv')

await stat(source)

console.log(`Footprint export ready for the local API: ${source}`)
