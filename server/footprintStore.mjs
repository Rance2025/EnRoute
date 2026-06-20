import { mkdirSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'

const TILE_SIZE = 256
const MAX_MERCATOR_LATITUDE = 85.05112878
const OPEN_ENDED_TIMESTAMP_SECONDS = 8_640_000_000_000

export function createFootprintStore({
  dbPath = process.env.FOOTPRINT_DB_PATH ?? 'output/footprints.sqlite',
  loadPoints,
  dataPath,
  coordinateSystem,
} = {}) {
  if (typeof loadPoints !== 'function') {
    throw new Error('createFootprintStore requires loadPoints')
  }

  const resolvedDbPath = resolve(dbPath)
  mkdirSync(dirname(resolvedDbPath), { recursive: true })
  const db = new DatabaseSync(resolvedDbPath)
  initializeSchema(db)

  return {
    async getSnapshot(input) {
      await ensureImported(db, {
        loadPoints,
        dataPath,
        coordinateSystem,
      })

      return querySnapshot(db, normalizeSnapshotInput(input))
    },
    close() {
      db.close()
    },
  }
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS footprint_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS footprints (
      id TEXT PRIMARY KEY,
      timestamp_seconds INTEGER NOT NULL,
      longitude REAL NOT NULL,
      latitude REAL NOT NULL,
      accuracy REAL NOT NULL,
      speed REAL NOT NULL,
      distance REAL NOT NULL,
      heading REAL NOT NULL,
      altitude REAL NOT NULL,
      loc_type REAL NOT NULL,
      is_back_foreground REAL NOT NULL,
      step_type REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_footprints_time ON footprints(timestamp_seconds);
    CREATE INDEX IF NOT EXISTS idx_footprints_lng_lat_time
      ON footprints(longitude, latitude, timestamp_seconds);
    CREATE VIRTUAL TABLE IF NOT EXISTS footprint_spatial USING rtree(
      footprint_rowid,
      min_lng,
      max_lng,
      min_lat,
      max_lat
    );
  `)
}

async function ensureImported(db, { loadPoints, dataPath, coordinateSystem }) {
  const sourceSignature = createSourceSignature(dataPath, coordinateSystem)
  const storedSignature = getMetaValue(db, 'sourceSignature')
  const storedCount = Number(getMetaValue(db, 'rowCount') ?? 0)
  const storedSpatialCount = getSpatialRowCount(db)

  if (storedSignature === sourceSignature && storedCount > 0 && storedSpatialCount === storedCount) return

  const payload = await loadPoints({ dataPath, coordinateSystem })
  const points = payload.points ?? []

  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM footprint_spatial')
    db.exec('DELETE FROM footprints')
    const insert = db.prepare(`
      INSERT INTO footprints (
        id,
        timestamp_seconds,
        longitude,
        latitude,
        accuracy,
        speed,
        distance,
        heading,
        altitude,
        loc_type,
        is_back_foreground,
        step_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSpatial = db.prepare(`
      INSERT INTO footprint_spatial (
        footprint_rowid,
        min_lng,
        max_lng,
        min_lat,
        max_lat
      ) VALUES (?, ?, ?, ?, ?)
    `)

    for (const point of points) {
      const result = insert.run(
        point.id,
        point.timestampSeconds,
        point.longitude,
        point.latitude,
        point.accuracy,
        point.speed,
        point.distance,
        point.heading,
        point.altitude,
        point.locType,
        point.isBackForeground,
        point.stepType,
      )
      insertSpatial.run(
        result.lastInsertRowid,
        point.longitude,
        point.longitude,
        point.latitude,
        point.latitude,
      )
    }

    setMetaValue(db, 'sourceSignature', sourceSignature)
    setMetaValue(db, 'rowCount', String(points.length))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function querySnapshot(db, input) {
  const metrics = queryMetrics(db, input)
  const selectedBounds = querySelectedBounds(db, input)
  const viewportRows = queryViewportRows(db, input)
  const points = aggregateRows(viewportRows, input)
  const rawCount = viewportRows.length

  return {
    points,
    metrics,
    selectedBounds,
    debug: {
      rawCount,
      renderedCount: points.length,
      renderRatio: rawCount === 0 ? 0 : points.length / rawCount,
    },
  }
}

function queryMetrics(db, input) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS selectedCount,
      COALESCE(SUM(CASE WHEN distance > 0 THEN distance ELSE 0 END), 0) AS totalDistanceMeters
    FROM footprints
    WHERE timestamp_seconds >= ?
      AND timestamp_seconds <= ?
  `).get(
    input.timeRange.startTimestampSeconds,
    input.timeRange.endTimestampSeconds,
  )
  const totalDistanceMeters = Number(row.totalDistanceMeters)

  return {
    selectedCount: Number(row.selectedCount),
    totalDistanceMeters,
    averageDistanceMetersPerDay: totalDistanceMeters / Math.max(input.timeRange.dayCount, 1),
  }
}

function querySelectedBounds(db, input) {
  const row = db.prepare(`
    SELECT
      MIN(longitude) AS west,
      MIN(latitude) AS south,
      MAX(longitude) AS east,
      MAX(latitude) AS north
    FROM footprints
    WHERE timestamp_seconds >= ?
      AND timestamp_seconds <= ?
  `).get(
    input.timeRange.startTimestampSeconds,
    input.timeRange.endTimestampSeconds,
  )

  if (
    row.west === null ||
    row.south === null ||
    row.east === null ||
    row.north === null
  ) {
    return null
  }

  return {
    southWest: [Number(row.west), Number(row.south)],
    northEast: [Number(row.east), Number(row.north)],
  }
}

function queryViewportRows(db, input) {
  const longitudeClause = input.viewportBounds.west <= input.viewportBounds.east
    ? 's.min_lng <= $east AND s.max_lng >= $west'
    : '(s.min_lng <= $east OR s.max_lng >= $west)'

  return db.prepare(`
    SELECT
      f.id,
      f.timestamp_seconds AS timestampSeconds,
      f.longitude,
      f.latitude,
      f.accuracy,
      f.distance
    FROM footprint_spatial s
    JOIN footprints f ON f.rowid = s.footprint_rowid
    WHERE f.timestamp_seconds >= $startTimestampSeconds
      AND f.timestamp_seconds <= $endTimestampSeconds
      AND s.min_lat <= $north
      AND s.max_lat >= $south
      AND ${longitudeClause}
  `).all({
    $startTimestampSeconds: input.timeRange.startTimestampSeconds,
    $endTimestampSeconds: input.timeRange.endTimestampSeconds,
    $west: input.viewportBounds.west,
    $east: input.viewportBounds.east,
    $south: input.viewportBounds.south,
    $north: input.viewportBounds.north,
  })
}

function aggregateRows(rows, input) {
  const buckets = new Map()
  const worldWidthPx = TILE_SIZE * 2 ** input.zoom

  for (const row of rows) {
    const projected = projectLngLat([Number(row.longitude), Number(row.latitude)], input.zoom)
    const relativeX = normalizeViewportRelativeWorldX(
      projected.x,
      input.viewportNorthWestWorldPixel.x,
      worldWidthPx,
    )
    const bucketX = Math.floor(relativeX / input.cellSizePx)
    const bucketY = Math.floor((projected.y - input.viewportNorthWestWorldPixel.y) / input.cellSizePx)
    const bucketKey = `${bucketX}:${bucketY}`
    const bucket = buckets.get(bucketKey)

    if (!bucket) {
      buckets.set(bucketKey, {
        count: 1,
        sumRelativeX: relativeX,
        sumY: projected.y,
        minAccuracy: Number(row.accuracy),
        startTimestampSeconds: Number(row.timestampSeconds),
        endTimestampSeconds: Number(row.timestampSeconds),
      })
      continue
    }

    bucket.count += 1
    bucket.sumRelativeX += relativeX
    bucket.sumY += projected.y
    bucket.minAccuracy = Math.min(bucket.minAccuracy, Number(row.accuracy))
    bucket.startTimestampSeconds = Math.min(bucket.startTimestampSeconds, Number(row.timestampSeconds))
    bucket.endTimestampSeconds = Math.max(bucket.endTimestampSeconds, Number(row.timestampSeconds))
  }

  return [...buckets.entries()].map(([id, bucket]) => {
    const averageX = normalizeWorldX(
      input.viewportNorthWestWorldPixel.x + bucket.sumRelativeX / bucket.count,
      worldWidthPx,
    )
    const [longitude, latitude] = unprojectWorldPoint(
      {
        x: averageX,
        y: bucket.sumY / bucket.count,
      },
      input.zoom,
    )

    return {
      id,
      longitude,
      latitude,
      count: bucket.count,
      minAccuracy: bucket.minAccuracy,
      startTimestampSeconds: bucket.startTimestampSeconds,
      endTimestampSeconds: bucket.endTimestampSeconds,
    }
  })
}

function normalizeSnapshotInput(input) {
  const cellSizePx = Number(input?.cellSizePx)
  const endTimestampSeconds = Number(input?.timeRange?.endTimestampSeconds)

  return {
    timeRange: {
      startTimestampSeconds: Number(input?.timeRange?.startTimestampSeconds),
      endTimestampSeconds: Number.isFinite(endTimestampSeconds)
        ? endTimestampSeconds
        : OPEN_ENDED_TIMESTAMP_SECONDS,
      dayCount: Number(input?.timeRange?.dayCount),
    },
    zoom: Number(input?.zoom),
    cellSizePx: Number.isFinite(cellSizePx) && cellSizePx > 0 ? cellSizePx : 0.5,
    viewportBounds: {
      west: Number(input?.viewportBounds?.west),
      south: Number(input?.viewportBounds?.south),
      east: Number(input?.viewportBounds?.east),
      north: Number(input?.viewportBounds?.north),
    },
    viewportNorthWestWorldPixel: {
      x: Number(input?.viewportNorthWestWorldPixel?.x),
      y: Number(input?.viewportNorthWestWorldPixel?.y),
    },
  }
}

function createSourceSignature(dataPath, coordinateSystem) {
  const resolvedDataPath = resolve(dataPath ?? process.env.FOOTPRINT_DATA_PATH ?? 'external/backUpData-all.csv')
  let stat
  try {
    stat = statSync(resolvedDataPath)
  } catch {
    stat = { mtimeMs: 0, size: 0 }
  }

  return JSON.stringify({
    dataPath: resolvedDataPath,
    coordinateSystem: coordinateSystem ?? process.env.FOOTPRINT_COORDINATE_SYSTEM ?? 'wgs84',
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  })
}

function getMetaValue(db, key) {
  const row = db.prepare('SELECT value FROM footprint_meta WHERE key = ?').get(key)

  return row?.value
}

function getSpatialRowCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM footprint_spatial').get()

  return Number(row.count)
}

function setMetaValue(db, key, value) {
  db.prepare(`
    INSERT INTO footprint_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function projectLngLat([lng, lat], zoom) {
  const scale = TILE_SIZE * 2 ** zoom
  const clampedLat = Math.min(Math.max(lat, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE)
  const sinLat = Math.sin((clampedLat * Math.PI) / 180)

  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

function unprojectWorldPoint(point, zoom) {
  const scale = TILE_SIZE * 2 ** zoom
  const lng = (point.x / scale) * 360 - 180
  const latRadians = Math.atan(Math.sinh(Math.PI * (1 - (2 * point.y) / scale)))

  return [lng, (latRadians * 180) / Math.PI]
}

function normalizeViewportRelativeWorldX(projectedX, originX, worldWidthPx) {
  const relativeX = projectedX - originX

  return relativeX < 0 ? relativeX + worldWidthPx : relativeX
}

function normalizeWorldX(x, worldWidthPx) {
  const normalizedX = x % worldWidthPx

  return normalizedX < 0 ? normalizedX + worldWidthPx : normalizedX
}
