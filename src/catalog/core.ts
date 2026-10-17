import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream, existsSync, realpathSync } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, sep } from 'node:path'
import type { SQLInputValue, StatementSync } from 'node:sqlite'
import type {
  Filter,
  Folder,
  IndexPhase,
  LibraryIndex,
  MediaItem,
  Scene,
  TranscriptSegment,
} from '../shared/api.ts'
import { dataPaths } from '../shared/paths.ts'
import {
  type CatalogChange,
  type ComputeApi,
  GENERATION,
  type OcrResult,
  type Probe,
  type SpeechResult,
  type Sprite,
  type VisualResult,
} from '../shared/protocol.ts'
import { openDatabase, transaction } from './schema.ts'

const images = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.bmp',
])
const videos = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.mts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv',
])
const generations = { thumb: 1, ...GENERATION }
type Stage = keyof typeof generations
type FolderRow = { id: number; path: string; count: number; offline: number }
type FileRow = {
  path: string
  media_id: number
  size: number
  mtime_ms: number
}
type Job = FileRow & {
  stage: Stage
  generation: number
  kind: number
  duration_ms: number | null
}
type MediaRow = {
  id: number
  kind: number
  width: number
  height: number
  taken_at: number
  duration_ms: number | null
  bytes: number
  sprite: string | null
  folder_id: number
  name: string
  path: string
}
type Work = {
  stage: Stage
  kind: number
  phase: 'thumbnails' | 'images' | 'videos' | 'speech' | 'text'
  limit: number
}
const phases: Work[] = [
  { stage: 'thumb', kind: -1, phase: 'thumbnails', limit: 2 },
  { stage: 'visual', kind: 0, phase: 'images', limit: 1 },
  { stage: 'visual', kind: 1, phase: 'videos', limit: 1 },
  { stage: 'ocr', kind: -1, phase: 'text', limit: 1 },
  { stage: 'speech', kind: 1, phase: 'speech', limit: 1 },
]

const SAMPLED_ABOVE = 64 * 1024 * 1024
const WINDOW = 4 * 1024 * 1024

async function fullHash(path: string): Promise<Buffer> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest()
}

// files over 64 MiB are keyed by size + head/middle/tail 4 MiB windows, not a full read;
// a full sha256 of a 96 GB remux stalled the scan for minutes. a sampled match is only
// trusted after a full-hash comparison against a present alias (see Catalog.confirmSampled).
async function contentHash(path: string, size: number): Promise<Buffer> {
  if (size <= SAMPLED_ABOVE) return fullHash(path)
  const hash = createHash('sha256')
  hash.update(`sampled:${size}:`)
  const file = await open(path)
  try {
    const buffer = Buffer.allocUnsafe(WINDOW)
    for (const position of [
      0,
      Math.floor((size - WINDOW) / 2),
      size - WINDOW,
    ]) {
      const { bytesRead } = await file.read(buffer, 0, WINDOW, position)
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await file.close()
  }
  return hash.digest()
}

export class Catalog extends EventEmitter<{
  index: [IndexPhase]
  libraryChanged: []
  change: [CatalogChange]
  warning: [Error]
}> {
  private readonly db
  private readonly statements = new Map<string, StatementSync>()
  private scans = Promise.resolve()
  private scanning = 0
  private found = 0
  private active = new Set<Promise<void>>()
  private paused = false
  private closed = false
  private changed = new Set<number>()
  private removed = new Set<number>()
  private libraryDirty = false
  private changeTimer: ReturnType<typeof setTimeout> | undefined
  private progressTimer: ReturnType<typeof setTimeout> | undefined

  private readonly compute: ComputeApi
  private readonly dataDir: string

  constructor(dataDir: string, compute: ComputeApi) {
    super()
    this.compute = compute
    this.db = openDatabase(dataPaths(dataDir).db)
    this.dataDir = realpathSync(dataDir)
    this.db.exec(
      "create temp table offline_folder(id integer primary key); update job set state = 'pending' where state = 'running'",
    )
    this.enqueue()
  }

  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  private enqueue(mediaId?: number): void {
    for (const stage of ['thumb', 'visual', 'ocr', 'speech'] as const) {
      const condition =
        stage === 'thumb'
          ? '1'
          : "exists(select 1 from job t where t.media_id=m.id and t.stage='thumb' and t.state='done')" +
            (stage === 'speech' ? ' and m.has_audio=1' : '') +
            (stage === 'ocr'
              ? ` and exists(select 1 from job v where v.media_id=m.id
              and v.stage='visual' and v.state='done' and v.generation=${GENERATION.visual})`
              : '')
      this.stmt(`insert into job(media_id, stage, generation, state)
        select m.id, ?, ?, 'pending' from media m
        where exists(select 1 from file f where f.media_id=m.id) and ${condition} and ${mediaId === undefined ? '1' : 'm.id=?'}
        on conflict(media_id,stage) do update set generation=excluded.generation,
          state='pending', attempts=0, error=null where job.generation != excluded.generation`).run(
        stage,
        generations[stage],
        ...(mediaId === undefined ? [] : [mediaId]),
      )
    }
  }

  folders(): Folder[] {
    return this.all<FolderRow>(`select d.id,d.path,count(distinct f.media_id) as count,
      exists(select 1 from offline_folder where id=d.id) as offline from folder d
      left join file f on f.folder_id=d.id group by d.id order by d.added_at,d.id`).map(
      (row) => ({
        id: row.id,
        path: row.path,
        name: basename(row.path) || row.path,
        count: row.count,
        state: !row.offline && existsSync(row.path) ? 'online' : 'offline',
      }),
    )
  }

  async addFolder(
    path: string,
    beforeScan?: (path: string, folderId: number) => Promise<void>,
  ): Promise<Folder> {
    let canonical = await realpath(path)
    if (canonical === this.dataDir)
      throw new Error('cannot index viquery data directory')
    if (!(await stat(canonical)).isDirectory())
      throw new Error('folder must be a directory')
    // a file belongs to exactly one folder: the outermost library folder containing it.
    // adding a nested folder resolves to its container; adding a container absorbs nested folders.
    const existing = this.all<{ id: number; path: string }>(
      'select id,path from folder',
    )
    canonical =
      existing.find((folder) => contains(folder.path, canonical))?.path ??
      canonical
    const folder = transaction(this.db, () => {
      this.stmt(
        'insert into folder(path,added_at) values (?,?) on conflict(path) do nothing',
      ).run(canonical, Date.now())
      const row = this.one<{ id: number }>(
        'select id from folder where path=?',
        canonical,
      ) as { id: number }
      for (const nested of existing.filter((folder) =>
        contains(canonical, folder.path),
      )) {
        this.stmt('update file set folder_id=? where folder_id=?').run(
          row.id,
          nested.id,
        )
        this.stmt('delete from offline_folder where id=?').run(nested.id)
        this.stmt('delete from folder where id=?').run(nested.id)
      }
      return row
    })
    this.notify([])
    await beforeScan?.(canonical, folder.id)
    await this.rescan(folder.id)
    return this.folders().find((entry) => entry.id === folder.id) as Folder
  }

  removeFolder(id: number): void {
    const affected = this.all<{ media_id: number }>(
      'select distinct media_id from file where folder_id=?',
      id,
    )
    transaction(this.db, () =>
      this.stmt('delete from folder where id=?').run(id),
    )
    this.notify(affected.map((row) => row.media_id))
    this.progress()
  }

  lookup(id: number): string | null {
    const aliases = this.all<{ path: string }>(
      'select path from file where media_id=? order by id',
      id,
    )
    return aliases.find((alias) => existsSync(alias.path))?.path ?? null
  }

  library(filter: Filter): LibraryIndex {
    const where = ['exists(select 1 from file f where f.media_id=m.id)']
    const params: SQLInputValue[] = []
    if (filter.scope.kind === 'folder') {
      where.push(
        'exists(select 1 from file f where f.media_id=m.id and f.folder_id=?)',
      )
      params.push(filter.scope.folderId)
    }
    if (filter.scope.kind === 'recent') {
      where.push('m.added_at>=?')
      params.push(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }
    if (filter.media !== 'all') {
      where.push('m.kind=?')
      params.push(filter.media === 'image' ? 0 : 1)
    }
    if (filter.takenFrom !== undefined) {
      where.push('m.taken_at>=?')
      params.push(filter.takenFrom)
    }
    if (filter.takenTo !== undefined) {
      where.push('m.taken_at<?')
      params.push(filter.takenTo)
    }
    const rows = this.all<MediaRow & { ready: number }>(
      `select m.*,exists(select 1 from job j where j.media_id=m.id and j.stage='thumb' and j.state='done') as ready
      from media m where ${where.join(' and ')}
      order by m.taken_at desc,m.id desc`,
      ...params,
    )
    return {
      ids: Uint32Array.from(rows, (row) => row.id),
      ready: Uint8Array.from(rows, (row) => row.ready),
      aspect: Float32Array.from(rows, (row) => row.width / row.height),
      kind: Uint8Array.from(rows, (row) => row.kind),
      takenAt: Float64Array.from(rows, (row) => row.taken_at),
      durationMs: Uint32Array.from(rows, (row) => row.duration_ms ?? 0),
    }
  }

  items(ids: number[]): MediaItem[] {
    return ids.flatMap((id) => {
      const row = this.one<MediaRow>(
        `select m.*,f.folder_id,f.name,f.path from media m
        join file f on f.id=(select min(id) from file where media_id=m.id) where m.id=?`,
        id,
      )
      return row
        ? [
            {
              id: row.id,
              kind: row.kind === 0 ? ('image' as const) : ('video' as const),
              folderId: row.folder_id,
              name: row.name,
              path: row.path,
              width: row.width,
              height: row.height,
              takenAt: row.taken_at,
              durationMs: row.duration_ms,
              bytes: row.bytes,
              sprite: row.sprite ? JSON.parse(row.sprite) : null,
            },
          ]
        : []
    })
  }

  scenes(id: number): Scene[] {
    return this.all<Scene>(
      `select s.id,s.start_ms as startMs,s.end_ms as endMs,
      coalesce((select p.t_ms from sample p join scene c on c.id=p.scene_id where p.scene_id=s.id order by abs(p.t_ms-(c.start_ms+c.end_ms)/2),p.id limit 1),s.start_ms) as frameMs
      from scene s where s.media_id=? and s.generation=? order by s.start_ms`,
      id,
      GENERATION.visual,
    )
  }

  transcript(id: number): TranscriptSegment[] {
    return this.all<TranscriptSegment>(
      `select start_ms as startMs,end_ms as endMs,text,language
      from transcript where media_id=? and generation=? order by start_ms`,
      id,
      GENERATION.speech,
    )
  }

  pauseIndexing(paused: boolean): void {
    this.paused = paused
    this.progress()
    if (!paused) this.pump()
  }

  rescan(folderId?: number): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.scans = this.scans
      .catch(() => {})
      .then(async () => {
        this.scanning++
        this.found = 0
        this.db.exec(
          "update job set state='pending',attempts=0,error=null where state='failed'",
        )
        this.progress()
        this.pump() // already-queued thumbnails run while the scan walks
        try {
          const folders = this.all<FolderRow>(
            `select id,path from folder${folderId === undefined ? '' : ' where id=?'}`,
            ...(folderId === undefined ? [] : [folderId]),
          )
          for (const folder of folders) {
            try {
              await this.scanFolder(folder)
            } catch (error) {
              if (
                ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes(
                  (error as NodeJS.ErrnoException).code ?? '',
                )
              ) {
                this.stmt(
                  'insert or ignore into offline_folder(id) values (?)',
                ).run(folder.id)
              }
              this.emit(
                'warning',
                new Error(`${folder.path}: ${errorMessage(error)}`),
              )
            }
          }
          this.enqueue()
        } finally {
          this.scanning--
          this.flushChanges()
          this.progress()
          this.pump()
        }
      })
    return this.scans
  }

  private async scanFolder(folder: FolderRow): Promise<void> {
    const seen = new Set<string>()
    const previous = this.all<FileRow>(
      'select path,media_id,size,mtime_ms from file where folder_id=?',
      folder.id,
    )
    const byPath = new Map(previous.map((file) => [file.path, file]))
    const rootInfo = await stat(folder.path)
    for await (const path of walk(folder.path, this.dataDir)) {
      if (
        this.closed ||
        !this.one('select id from folder where id=?', folder.id)
      )
        return
      seen.add(path)
      this.found++
      this.progress()
      try {
        const before = await stat(path)
        const old = byPath.get(path)
        if (old?.size === before.size && old.mtime_ms === before.mtimeMs)
          continue
        let digest = await contentHash(path, before.size)
        if (before.size > SAMPLED_ABOVE)
          digest = await this.confirmSampled(digest, path)
        const after = await stat(path)
        if (!sameFile(before, after)) continue
        const mediaId = transaction(this.db, () => {
          const row = this.one<{ id: number }>(
            `insert into media
            (sha256,kind,width,height,duration_ms,has_audio,taken_at,added_at,bytes)
            values (?,?,1,1,null,0,?,?,?) on conflict(sha256) do update set sha256=excluded.sha256 returning id`,
            digest,
            videos.has(extname(path).toLowerCase()) ? 1 : 0,
            before.mtimeMs,
            Date.now(),
            before.size,
          )
          const id = (row as { id: number }).id
          this.stmt(`insert into file(path,folder_id,media_id,name,size,mtime_ms) values (?,?,?,?,?,?)
            on conflict(path) do update set folder_id=excluded.folder_id,media_id=excluded.media_id,
              name=excluded.name,size=excluded.size,mtime_ms=excluded.mtime_ms`).run(
            path,
            folder.id,
            id,
            basename(path),
            before.size,
            before.mtimeMs,
          )
          this.stmt(
            "insert into job(media_id,stage,generation,state) values (?,'thumb',?,'pending') on conflict do nothing",
          ).run(id, generations.thumb)
          return id
        })
        this.notify(old ? [old.media_id, mediaId] : [mediaId])
        this.pump() // thumbnails start while the scan continues
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const currentRoot = await stat(folder.path)
    if (rootInfo.ino !== currentRoot.ino || rootInfo.dev !== currentRoot.dev)
      throw new Error('folder changed during scan')
    this.stmt('delete from offline_folder where id=?').run(folder.id)
    const vanished = previous.filter((file) => !seen.has(file.path))
    transaction(this.db, () => {
      for (const file of vanished)
        this.stmt('delete from file where path=? and folder_id=?').run(
          file.path,
          folder.id,
        )
    })
    if (vanished.length) this.notify(vanished.map((file) => file.media_id))
  }

  // a sampled key shared with another unchanged alias is confirmed by hashing both files fully;
  // different content is keyed by its full sha256 instead. renames/moves (no other alias still
  // present) keep the sampled match without a full read.
  // ponytail: a distinct file whose sampled twin is gone (moved away or deleted) inherits its identity.
  // upgrade: persist full hashes per media and compare when a sampled match has no present alias.
  private async confirmSampled(digest: Buffer, path: string): Promise<Buffer> {
    const aliases = this.all<FileRow>(
      `select f.path,f.size,f.mtime_ms from file f join media m on m.id=f.media_id
      where m.sha256=? and f.path!=?`,
      digest,
      path,
    )
    for (const alias of aliases) {
      const info = await stat(alias.path).catch(() => null)
      if (info?.size !== alias.size || info.mtimeMs !== alias.mtime_ms) continue
      const [mine, theirs] = await Promise.all([
        fullHash(path),
        fullHash(alias.path),
      ])
      return mine.equals(theirs) ? digest : mine
    }
    return digest
  }

  private notify(ids: number[]): void {
    this.libraryDirty = true
    for (const id of ids) {
      if (this.one('select 1 from file where media_id=?', id)) {
        this.changed.add(id)
        this.removed.delete(id)
      } else {
        this.removed.add(id)
        this.changed.delete(id)
      }
    }
    if (!this.changeTimer)
      this.changeTimer = setTimeout(() => this.flushChanges(), 100)
  }

  private flushChanges(): void {
    clearTimeout(this.changeTimer)
    this.changeTimer = undefined
    if (!this.libraryDirty) return
    this.libraryDirty = false
    const change: CatalogChange = {
      changedMedia: [...this.changed],
      removedMedia: [...this.removed],
    }
    this.changed.clear()
    this.removed.clear()
    this.emit('change', change)
    this.emit('libraryChanged')
  }

  private work(): Work | undefined {
    return phases.find((phase) =>
      this.one(
        `select 1 from job j join media m on m.id=j.media_id
      where j.stage=? and (?=-1 or m.kind=?) and j.state in ('pending','running')
      and exists(select 1 from file f where f.media_id=m.id and f.folder_id not in (select id from offline_folder)) limit 1`,
        phase.stage,
        phase.kind,
        phase.kind,
      ),
    )
  }

  private pump(): void {
    if (this.paused || this.closed) return
    const work = this.work()
    if (!work || (this.scanning && work.stage !== 'thumb')) {
      this.progress()
      return
    }
    const running =
      this.one<{ n: number }>(
        "select count(*) as n from job where state='running'",
      )?.n ?? 0
    for (let i = running; i < work.limit; i++) {
      const job = this.one<Job>(
        `select j.media_id,j.stage,j.generation,m.kind,m.duration_ms,f.path,f.size,f.mtime_ms
        from job j join media m on m.id=j.media_id
        join file f on f.id=(select min(id) from file where media_id=m.id and folder_id not in (select id from offline_folder))
        where j.state='pending' and j.stage=? and (?=-1 or m.kind=?) order by m.id limit 1`,
        work.stage,
        work.kind,
        work.kind,
      )
      if (!job) break
      this.stmt(
        "update job set state='running',attempts=attempts+1,error=null where media_id=? and stage=?",
      ).run(job.media_id, job.stage)
      const task = this.runJob(job).finally(() => {
        this.active.delete(task)
        this.progress()
        this.pump()
      })
      this.active.add(task)
    }
    this.progress()
  }

  private async runJob(job: Job): Promise<void> {
    try {
      await this.checkFile(job)
      let result:
        | { probe: Probe; sprite: Sprite | null }
        | VisualResult
        | OcrResult
        | SpeechResult
      if (job.stage === 'thumb') {
        const probe = await this.compute.probe({ path: job.path })
        validateProbe(probe, job.kind)
        const thumb = await this.compute.thumb({
          mediaId: job.media_id,
          path: job.path,
          kind: probe.kind,
          durationMs: probe.durationMs,
        })
        validateSprite(thumb.sprite)
        result = { probe, sprite: thumb.sprite }
      } else if (job.stage === 'visual') {
        result = await this.compute.visual({
          mediaId: job.media_id,
          path: job.path,
          kind: job.kind === 0 ? 'image' : 'video',
          durationMs: job.duration_ms,
        })
        validateVisual(result, job)
      } else if (job.stage === 'ocr') {
        result = await this.compute.ocr(
          job.kind === 0
            ? {
                mediaId: job.media_id,
                path: job.path,
                kind: 'image',
              }
            : {
                mediaId: job.media_id,
                path: job.path,
                kind: 'video',
                frameMs: this.all<{ t_ms: number }>(
                  'select distinct t_ms from sample where media_id=? and generation=? order by t_ms',
                  job.media_id,
                  GENERATION.visual,
                ).map((sample) => sample.t_ms),
              },
        )
        validateOcr(result, job)
      } else {
        result = await this.compute.speech({
          mediaId: job.media_id,
          path: job.path,
        })
        validateSpeech(result, job)
      }
      await this.checkFile(job)
      transaction(this.db, () => {
        if (
          !this.one(
            `select 1 from job where media_id=? and stage=? and generation=? and state='running'
          and exists(select 1 from file where media_id=?)`,
            job.media_id,
            job.stage,
            job.generation,
            job.media_id,
          )
        )
          return
        if ('probe' in result) {
          const p = result.probe
          this.stmt(`update media set width=?,height=?,duration_ms=?,has_audio=?,taken_at=coalesce(?,taken_at),codec=?,sprite=?
            where id=?`).run(
            p.width,
            p.height,
            p.durationMs,
            Number(p.hasAudio),
            p.takenAt,
            p.codec,
            result.sprite ? JSON.stringify(result.sprite) : null,
            job.media_id,
          )
        } else if ('scenes' in result) this.writeVisual(job, result)
        else if ('spans' in result) this.writeOcr(job, result)
        else this.writeSpeech(job, result)
        this.stmt(
          "update job set state='done',error=null where media_id=? and stage=? and generation=?",
        ).run(job.media_id, job.stage, job.generation)
        this.enqueue(job.media_id)
      })
      this.notify([job.media_id])
    } catch (error) {
      this.stmt(`update job set state=case when attempts>=3 then 'failed' else 'pending' end,error=?
        where media_id=? and stage=? and generation=? and state='running'`).run(
        errorMessage(error),
        job.media_id,
        job.stage,
        job.generation,
      )
      this.emit(
        'warning',
        new Error(`${job.stage} ${job.path}: ${errorMessage(error)}`),
      )
    } finally {
      this.stmt(
        "update job set state='pending' where media_id=? and stage=? and state='running'",
      ).run(job.media_id, job.stage)
    }
  }

  private async checkFile(job: Job): Promise<void> {
    const current = await stat(job.path)
    if (current.size !== job.size || current.mtimeMs !== job.mtime_ms) {
      void this.rescan()
      throw new Error('file changed during indexing; rescan queued')
    }
  }

  private writeVisual(job: Job, result: VisualResult): void {
    this.stmt('delete from ocr where media_id=?').run(job.media_id)
    this.stmt("delete from job where media_id=? and stage='ocr'").run(
      job.media_id,
    )
    this.stmt('delete from sample where media_id=?').run(job.media_id)
    this.stmt('delete from scene where media_id=?').run(job.media_id)
    const sceneIds = result.scenes.map((scene) =>
      Number(
        this.stmt(`insert into scene
      (media_id,generation,start_ms,end_ms) values (?,?,?,?)`).run(
          job.media_id,
          result.generation,
          scene.startMs,
          scene.endMs,
        ).lastInsertRowid,
      ),
    )
    for (const sample of result.samples) {
      this.stmt(
        'insert into sample(media_id,scene_id,generation,t_ms,embedding) values (?,?,?,?,?)',
      ).run(
        job.media_id,
        sample.scene < 0 ? null : (sceneIds[sample.scene] as number),
        result.generation,
        sample.tMs,
        vectorBytes(sample.embedding),
      )
    }
  }

  private writeOcr(job: Job, result: OcrResult): void {
    this.stmt('delete from ocr where media_id=?').run(job.media_id)
    for (const span of result.spans) {
      this.stmt(
        'insert into ocr(media_id,generation,t_ms,text,embedding) values (?,?,?,?,?)',
      ).run(
        job.media_id,
        result.generation,
        span.tMs,
        span.text,
        vectorBytes(span.embedding),
      )
    }
  }

  private writeSpeech(job: Job, result: SpeechResult): void {
    this.stmt('delete from transcript where media_id=?').run(job.media_id)
    for (const segment of result.segments) {
      this.stmt(`insert into transcript(media_id,generation,start_ms,end_ms,language,text,embedding)
        values (?,?,?,?,?,?,?)`).run(
        job.media_id,
        result.generation,
        segment.startMs,
        segment.endMs,
        segment.language,
        segment.text,
        vectorBytes(segment.embedding),
      )
    }
  }

  indexState(): IndexPhase {
    if (this.scanning) return { phase: 'scanning', found: this.found }
    const failed =
      this.one<{
        n: number
      }>(`select count(*) as n from job j where state='failed'
      and exists(select 1 from file where media_id=j.media_id)`)?.n ?? 0
    const work = this.work()
    if (!work)
      return {
        phase: 'idle',
        items:
          this.one<{ n: number }>(
            'select count(distinct media_id) as n from file',
          )?.n ?? 0,
        failed,
      }
    const count = this.one<{ done: number; total: number }>(
      `select
      coalesce(sum(j.state='done'),0) as done,count(*) as total from job j join media m on m.id=j.media_id
      where j.stage=? and (?=-1 or m.kind=?) and exists(select 1 from file where media_id=m.id)`,
      work.stage,
      work.kind,
      work.kind,
    ) as { done: number; total: number }
    return {
      phase: work.phase,
      ...count,
      etaMs: null,
      paused: this.paused,
      failed,
    }
  }

  private progress(): void {
    if (!this.progressTimer && !this.closed)
      this.progressTimer = setTimeout(() => {
        this.progressTimer = undefined
        this.emit('index', this.indexState())
      }, 100)
  }

  async settled(): Promise<void> {
    for (;;) {
      const scans = this.scans
      await scans
      await Promise.all(this.active)
      if (scans === this.scans && this.active.size === 0) break
    }
    this.flushChanges()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.settled()
    clearTimeout(this.progressTimer)
    this.db.close()
  }
}

async function* walk(path: string, ignored: string): AsyncGenerator<string> {
  const entries = await opendir(path)
  for await (const entry of entries) {
    const child = join(path, entry.name)
    if (
      child === ignored ||
      ['.Trash', '.Trashes', '$RECYCLE.BIN'].includes(entry.name)
    )
      continue
    if (entry.isDirectory()) yield* walk(child, ignored)
    else if (
      entry.isFile() &&
      (images.has(extname(child).toLowerCase()) ||
        videos.has(extname(child).toLowerCase()))
    )
      yield child
  }
}

function contains(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

function sameFile(
  a: Awaited<ReturnType<typeof stat>>,
  b: Awaited<ReturnType<typeof stat>>,
): boolean {
  return (
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function finite(n: unknown, min = 0): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min
}

function validateProbe(probe: Probe, kind: number): void {
  if (
    !probe ||
    probe.kind !== (kind === 0 ? 'image' : 'video') ||
    !finite(probe.width, 1) ||
    !finite(probe.height, 1) ||
    typeof probe.hasAudio !== 'boolean' ||
    !(probe.takenAt === null || finite(probe.takenAt, -Infinity)) ||
    !(probe.codec === null || typeof probe.codec === 'string') ||
    (kind === 0
      ? probe.durationMs !== null || probe.hasAudio
      : !finite(probe.durationMs, 1))
  ) {
    throw new Error('invalid compute probe')
  }
}

function validateSprite(sprite: Sprite | null): void {
  if (
    sprite !== null &&
    (!sprite ||
      !Number.isSafeInteger(sprite.columns) ||
      sprite.columns < 1 ||
      !Number.isSafeInteger(sprite.rows) ||
      sprite.rows < 1 ||
      !Number.isSafeInteger(sprite.frames) ||
      sprite.frames < 1 ||
      sprite.frames > sprite.rows * sprite.columns)
  )
    throw new Error('invalid compute sprite')
}

function vectorBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

function validVector(vector: Float32Array, length: number): boolean {
  if (!(vector instanceof Float32Array) || vector.length !== length)
    return false
  let norm = 0
  for (const n of vector) {
    if (!Number.isFinite(n)) return false
    norm += n * n
  }
  return Math.abs(norm - 1) < 0.01
}

function windowValid(
  start: number,
  end: number,
  duration: number | null,
): boolean {
  return (
    finite(start) &&
    finite(end) &&
    end > start &&
    (duration === null || end <= duration)
  )
}

function validateVisual(result: VisualResult, job: Job): void {
  if (
    !result ||
    result.generation !== job.generation ||
    !Array.isArray(result.scenes) ||
    !Array.isArray(result.samples) ||
    !result.samples.length
  )
    throw new Error('invalid visual generation or samples')
  let end = 0
  for (const scene of result.scenes) {
    if (
      !scene ||
      !windowValid(scene.startMs, scene.endMs, job.duration_ms) ||
      scene.startMs < end ||
      scene.endMs - scene.startMs > 10000
    )
      throw new Error('invalid visual scene')
    end = scene.endMs
  }
  if (
    job.kind === 0 &&
    (result.scenes.length !== 0 || result.samples.length !== 1)
  )
    throw new Error('invalid image samples')
  for (const sample of result.samples) {
    if (!sample || !validVector(sample.embedding, 512))
      throw new Error('invalid visual embedding')
    if (job.kind === 0) {
      if (sample.scene !== -1 || sample.tMs !== null)
        throw new Error('invalid image timestamp')
    } else {
      const scene = result.scenes[sample.scene]
      if (
        !Number.isSafeInteger(sample.scene) ||
        !scene ||
        !Number.isSafeInteger(sample.tMs) ||
        !finite(sample.tMs) ||
        sample.tMs < scene.startMs ||
        sample.tMs > scene.endMs
      )
        throw new Error('invalid sample timestamp')
    }
  }
  if (
    job.kind === 1 &&
    result.scenes.some(
      (_, i) => !result.samples.some((sample) => sample.scene === i),
    )
  ) {
    throw new Error('scene missing representative sample')
  }
}

function validateOcr(result: OcrResult, job: Job): void {
  if (
    !result ||
    result.generation !== job.generation ||
    !Array.isArray(result.spans)
  )
    throw new Error('invalid OCR generation')
  for (const span of result.spans) {
    if (
      !span ||
      typeof span.text !== 'string' ||
      !span.text.trim() ||
      !validVector(span.embedding, 384) ||
      (job.kind === 0
        ? span.tMs !== null
        : !Number.isSafeInteger(span.tMs) ||
          !finite(span.tMs) ||
          span.tMs >= (job.duration_ms as number))
    )
      throw new Error('invalid OCR span')
  }
}

function validateSpeech(result: SpeechResult, job: Job): void {
  if (
    !result ||
    result.generation !== job.generation ||
    !Array.isArray(result.segments)
  )
    throw new Error('invalid speech generation')
  for (const segment of result.segments) {
    if (
      !segment ||
      !windowValid(segment.startMs, segment.endMs, job.duration_ms) ||
      typeof segment.text !== 'string' ||
      typeof segment.language !== 'string' ||
      !validVector(segment.embedding, 384)
    )
      throw new Error('invalid speech segment')
  }
}
