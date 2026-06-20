// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createFootprintsRequestHandler, loadFootprintPayload } from './footprintsApi.mjs'

const csv = [
  'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
  '1768144456,1,121.511383,31.296564,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956',
].join('\n')
const snapshotCsv = [
  'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
  '1781798400,1,121.511383,31.296564,0.000000,5.729415,-1.000000,100.000000,1,0,10.146956',
  '1781840000,1,121.511384,31.296565,0.000000,4.729415,-1.000000,250.000000,1,0,10.146956',
  '1781840100,1,118.000000,30.000000,0.000000,6.729415,-1.000000,50.000000,1,0,10.146956',
  '1781884800,1,121.511385,31.296566,0.000000,5.729415,-1.000000,999.000000,1,0,10.146956',
].join('\n')

const servers = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
    ),
  )
})

describe('footprints API', () => {
  it('loads footprint points from the configured CSV path', async () => {
    const dataPath = await writeTempCsv()

    await expect(
      loadFootprintPayload({
        dataPath,
        coordinateSystem: 'gcj02',
      }),
    ).resolves.toEqual({
      points: [
        {
          id: '1768144456-0',
          timestampSeconds: 1768144456,
          longitude: 121.511383,
          latitude: 31.296564,
          accuracy: 5.729415,
          speed: -1,
          distance: 0,
          heading: 0,
          altitude: 10.146956,
          locType: 1,
          isBackForeground: 1,
          stepType: 0,
        },
      ],
    })
  })

  it('skips rows with invalid numeric fields instead of emitting null JSON fields', async () => {
    const dataPath = await writeTempCsv([
      'dataTime,locType,longitude,latitude,heading,accuracy,speed,distance,isBackForeground,stepType,altitude',
      '1768144456,1,121.511383,31.296564,0.000000,,not-a-number,0.000000,1,0,10.146956',
      '1768144457,1,121.511384,31.296565,0.000000,5.729415,-1.000000,0.000000,1,0,10.146956',
    ].join('\n'))

    await expect(
      loadFootprintPayload({
        dataPath,
        coordinateSystem: 'gcj02',
      }),
    ).resolves.toEqual({
      points: [
        expect.objectContaining({
          id: '1768144457-1',
          accuracy: 5.729415,
          speed: -1,
        }),
      ],
    })
  })

  it('serves GET /api/footprints as JSON', async () => {
    const dataPath = await writeTempCsv()
    const server = createServer(
      createFootprintsRequestHandler({
        dataPath,
        coordinateSystem: 'gcj02',
      }),
    )
    servers.push(server)
    const origin = await listen(server)

    const response = await fetch(`${origin}/api/footprints`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({
      points: [
        expect.objectContaining({
          id: '1768144456-0',
          longitude: 121.511383,
          latitude: 31.296564,
        }),
      ],
    })
  })

  it('serves POST /api/footprints/snapshot from a database-backed viewport query', async () => {
    const dataPath = await writeTempCsv(snapshotCsv)
    const dbPath = join(await mkdtemp(join(tmpdir(), 'enroute-footprints-db-')), 'footprints.sqlite')
    const server = createServer(
      createFootprintsRequestHandler({
        dataPath,
        dbPath,
        coordinateSystem: 'gcj02',
      }),
    )
    servers.push(server)
    const origin = await listen(server)

    const response = await fetch(`${origin}/api/footprints/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeRange: {
          startTimestampSeconds: 1781798400,
          endTimestampSeconds: 1781884799,
          dayCount: 1,
        },
        zoom: 16,
        cellSizePx: 8,
        viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
        viewportNorthWestWorldPixel: { x: 0, y: 0 },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      points: [
        expect.objectContaining({
          count: 2,
          minAccuracy: 4.729415,
          startTimestampSeconds: 1781798400,
          endTimestampSeconds: 1781840000,
        }),
      ],
      metrics: {
        selectedCount: 3,
        totalDistanceMeters: 400,
        averageDistanceMetersPerDay: 400,
      },
      selectedBounds: {
        southWest: [118, 30],
        northEast: [121.511384, 31.296565],
      },
      debug: {
        rawCount: 2,
        renderedCount: 1,
        renderRatio: 0.5,
      },
    })
  })

  it('imports footprints into a SQLite RTree viewport index for spatial filtering', async () => {
    const dataPath = await writeTempCsv(snapshotCsv)
    const dbPath = join(await mkdtemp(join(tmpdir(), 'enroute-footprints-db-')), 'footprints.sqlite')
    const server = createServer(
      createFootprintsRequestHandler({
        dataPath,
        dbPath,
        coordinateSystem: 'gcj02',
      }),
    )
    servers.push(server)
    const origin = await listen(server)

    await fetch(`${origin}/api/footprints/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeRange: {
          startTimestampSeconds: 1781798400,
          endTimestampSeconds: 1781884799,
          dayCount: 1,
        },
        zoom: 16,
        cellSizePx: 0.5,
        viewportBounds: { west: 121, south: 31, east: 122, north: 32 },
        viewportNorthWestWorldPixel: { x: 0, y: 0 },
      }),
    })

    const db = new DatabaseSync(dbPath)
    try {
      expect(db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'footprint_spatial'
      `).get()).toEqual({ name: 'footprint_spatial' })
      expect(db.prepare('SELECT COUNT(*) AS count FROM footprint_spatial').get()).toEqual({
        count: 4,
      })
    } finally {
      db.close()
    }
  })

  it('returns 404 for unknown routes', async () => {
    const dataPath = await writeTempCsv()
    const server = createServer(createFootprintsRequestHandler({ dataPath }))
    servers.push(server)
    const origin = await listen(server)

    const response = await fetch(`${origin}/api/unknown`)

    expect(response.status).toBe(404)
  })
})

async function writeTempCsv(content = csv) {
  const directory = await mkdtemp(join(tmpdir(), 'enroute-footprints-'))
  const dataPath = join(directory, 'backUpData-all.csv')
  await writeFile(dataPath, content, 'utf8')

  return dataPath
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })
}
