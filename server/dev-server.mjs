import { createServer } from 'node:http'

import { createFootprintsRequestHandler } from './footprintsApi.mjs'
import { loadLocalEnv } from '../scripts/load-local-env.mjs'

loadLocalEnv()

const host = process.env.ENROUTE_API_HOST ?? '127.0.0.1'
const port = Number(process.env.ENROUTE_API_PORT ?? 5178)

const server = createServer(createFootprintsRequestHandler())

server.listen(port, host, () => {
  console.log(`EnRoute API listening at http://${host}:${port}`)
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
