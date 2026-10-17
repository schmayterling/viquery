// biome-ignore-all lint/style/noNonNullAssertion: vector/scene indices and nonempty rank groups are bounded by the loaded snapshot.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  Filter,
  MatchSource,
  Moment,
  SceneMatch,
  SearchResult,
} from '../shared/api.ts'
import {
  type CatalogChange,
  GENERATION,
  type TextEncoders,
} from '../shared/protocol.ts'
import { Scanner } from './parallel.ts'
import { type VectorRow, Vectors } from './vectors.ts'

type Media = {
  id: number
  kind: number
  taken_at: number
  added_at: number
  folders: string
}
type Scene = { id: number; media_id: number; start_ms: number; end_ms: number }
type Target = { mediaId: number; scene: Scene | null }
type Evidence = {
  target: Target
  sources: Set<MatchSource>
  sample: { score: number; ms: number } | null
  segment: { startMs: number; text: string } | null
}
type Ranked = Evidence & { score: number }
type Lexical = {
  media_id: number
  start_ms: number | null
  end_ms: number | null
  text: string | null
  rank: number
}

const mediaSql = `select m.id, m.kind, m.taken_at, m.added_at,
  json_group_array(distinct f.folder_id) as folders from media m join file f on f.media_id = m.id`
const sampleSql = `select id, media_id, scene_id, t_ms as start_ms,
  coalesce(t_ms, 0) as end_ms, null as text, embedding from sample where generation = ?`
const transcriptSql = `select id, media_id, null as scene_id, start_ms, end_ms, text, embedding
  from transcript where generation = ?`
const sceneSql =
  'select id, media_id, start_ms, end_ms from scene where generation = ?'
// bench-calibration-results.json: CLIP positives .235–.335, negatives .150–.246, abstract tops >= .216; wide retrieval band, marker band < .0077 launch gap; JFK .761 vs unrelated <= .284.
const relevanceFloor = { visual: 0.2, speech: 0.45 }
const visualBand = { global: 0.08, timeline: 0.006 }
const relevanceCutoff = (
  source: 'visual' | 'speech',
  best: number,
  band: number,
) =>
  source === 'visual'
    ? Math.max(relevanceFloor.visual, best - band)
    : relevanceFloor.speech
const maxMomentMs = 30_000
const recentMs = 30 * 24 * 60 * 60 * 1000
const key = (t: Target) => (t.scene ? `s${t.scene.id}` : `m${t.mediaId}`)

function queryText(query: string) {
  if (typeof query !== 'string' || query.length > 4096)
    throw new Error('invalid search query (maximum 4096 characters)')
  return query.trim()
}

function ftsQuery(query: string) {
  // FTS5 strings use doubled quotes; SQL binding alone does not escape MATCH syntax.
  // SQLite FTS5 §3.1: https://sqlite.org/fts5.html (Node 24.22 bundled SQLite).
  return query
    .split(/\s+/u)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' OR ')
}

function filterSql(filter: Filter) {
  if (
    !filter ||
    !['all', 'image', 'video'].includes(filter.media) ||
    !filter.scope ||
    !['all', 'recent', 'folder'].includes(filter.scope.kind)
  ) {
    throw new Error('invalid search filter')
  }
  if (
    filter.scope.kind === 'folder' &&
    (!Number.isSafeInteger(filter.scope.folderId) || filter.scope.folderId <= 0)
  )
    throw new Error('invalid folder id')
  const where = ['exists(select 1 from file where media_id = m.id)']
  const params: Record<string, SQLInputValue> = {}
  if (filter.media !== 'all') {
    where.push('m.kind = $kind')
    params.kind = filter.media === 'image' ? 0 : 1
  }
  if (filter.scope.kind === 'folder') {
    where.push(
      'exists(select 1 from file where media_id = m.id and folder_id = $folder)',
    )
    params.folder = filter.scope.folderId
  }
  if (filter.scope.kind === 'recent') {
    where.push('m.added_at >= $recent')
    params.recent = Date.now() - recentMs
  }
  for (const [field, op] of [
    ['takenFrom', '>='],
    ['takenTo', '<'],
  ] as const) {
    if (filter[field] === undefined) continue
    if (!Number.isFinite(filter[field])) throw new Error('invalid search date')
    where.push(`m.taken_at ${op} $${field}`)
    params[field] = filter[field]!
  }
  return { where: where.join(' and '), params }
}

export class SearchEngine {
  private db: DatabaseSync
  private encoders: TextEncoders
  private visual = new Vectors(512)
  private speech = new Vectors(384)
  private media = new Map<number, Media & { folderIds: number[] }>()
  private scenes = new Map<number, Scene>()
  private mediaScenes = new Map<number, Scene[]>()
  private pending = new Set<number>()
  private queryVectors = new Map<string, [Float32Array, Float32Array]>()
  private videoFts: { mediaId: number; db: DatabaseSync } | undefined
  private scanner = new Scanner()
  private activeQueries = 0
  private deferred: CatalogChange[] = []

  constructor(path: string, encoders: TextEncoders) {
    // Node 24.22: keep the only writer in catalog; WAL readers see committed batches.
    // https://nodejs.org/docs/latest-v24.x/api/sqlite.html#new-databasesyncpath-options
    this.db = new DatabaseSync(path, { readOnly: true, timeout: 1000 })
    this.encoders = encoders
    this.read(() => {
      for (const row of this.db.prepare(`${mediaSql} group by m.id`).iterate())
        this.addMedia(row as Media)
      this.refreshPending()
      for (const row of this.db
        .prepare(`${sceneSql} order by start_ms, id`)
        .iterate(GENERATION.visual))
        this.addScene(row as Scene)
      for (const [table, sql, generation] of [
        [this.visual, sampleSql, GENERATION.visual],
        [this.speech, transcriptSql, GENERATION.speech],
      ] as const) {
        const name = table === this.visual ? 'sample' : 'transcript'
        const count = this.db
          .prepare(`select count(*) as n from ${name} where generation = ?`)
          .get(generation)!.n as number
        table.reserve(count)
        for (const row of this.db.prepare(sql).iterate(generation))
          if (this.media.has(row.media_id as number))
            table.append(row as VectorRow)
      }
    })
  }

  async close() {
    await this.scanner.close()
    this.videoFts?.db.close()
    this.db.close()
  }

  private async snapshot<T>(fn: () => Promise<T>): Promise<T> {
    this.activeQueries++
    try {
      return await fn()
    } finally {
      if (--this.activeQueries === 0)
        for (const change of this.deferred.splice(0)) this.refresh(change)
    }
  }

  private read<T>(fn: () => T): T {
    this.db.exec('begin')
    try {
      return fn()
    } finally {
      this.db.exec('rollback')
    }
  }

  private addMedia(row: Media) {
    this.media.set(row.id, {
      ...row,
      folderIds: JSON.parse(row.folders) as number[],
    })
  }

  private addScene(scene: Scene) {
    if (!this.media.has(scene.media_id)) return
    this.scenes.set(scene.id, scene)
    const scenes = this.mediaScenes.get(scene.media_id) ?? []
    scenes.push(scene)
    this.mediaScenes.set(scene.media_id, scenes)
  }

  refresh(change: CatalogChange) {
    if (this.activeQueries) {
      this.deferred.push(change)
      return
    }
    const removed = new Set([...change.changedMedia, ...change.removedMedia])
    if (this.videoFts && removed.has(this.videoFts.mediaId)) {
      this.videoFts.db.close()
      this.videoFts = undefined
    }
    this.visual.remove(removed)
    this.speech.remove(removed)
    for (const id of removed) {
      this.media.delete(id)
      for (const scene of this.mediaScenes.get(id) ?? [])
        this.scenes.delete(scene.id)
      this.mediaScenes.delete(id)
    }
    this.read(() => {
      const metadata = this.db.prepare(
        `${mediaSql} where m.id = ? group by m.id`,
      )
      const scenes = this.db.prepare(
        `${sceneSql} and media_id = ? order by start_ms, id`,
      )
      const samples = this.db.prepare(`${sampleSql} and media_id = ?`)
      const transcripts = this.db.prepare(`${transcriptSql} and media_id = ?`)
      this.refreshPending()
      const deleted = new Set(change.removedMedia)
      for (const id of new Set(change.changedMedia)) {
        if (deleted.has(id)) continue
        const row = metadata.get(id) as Media | undefined
        if (!row) continue
        this.addMedia(row)
        for (const scene of scenes.iterate(GENERATION.visual, id))
          this.addScene(scene as Scene)
        for (const sample of samples.iterate(GENERATION.visual, id))
          this.visual.append(sample as VectorRow)
        for (const segment of transcripts.iterate(GENERATION.speech, id))
          this.speech.append(segment as VectorRow)
      }
    })
  }

  private refreshPending() {
    this.pending = new Set(
      Array.from(
        this.db
          .prepare("select distinct media_id from job where state != 'done'")
          .iterate(),
        (row) => row.media_id as number,
      ),
    )
  }

  private selected(filter: Filter, recent?: number): Set<number> {
    const selected = new Set<number>()
    for (const m of this.media.values()) {
      if (
        filter.media !== 'all' &&
        m.kind !== (filter.media === 'image' ? 0 : 1)
      )
        continue
      if (
        filter.scope.kind === 'folder' &&
        !m.folderIds.includes(filter.scope.folderId)
      )
        continue
      if (recent !== undefined && m.added_at < recent) continue
      if (filter.takenFrom !== undefined && m.taken_at < filter.takenFrom)
        continue
      if (filter.takenTo !== undefined && m.taken_at >= filter.takenTo) continue
      selected.add(m.id)
    }
    return selected
  }

  async search(query: string, filter: Filter): Promise<SearchResult> {
    const start = performance.now()
    const text = queryText(query)
    const sqlFilter = filterSql(filter)
    if (!text)
      return this.result(
        query,
        [],
        this.selected(filter, sqlFilter.params.recent as number | undefined),
        start,
      )
    const [clip, sentence] = await this.encode(text)
    return this.snapshot(async () => {
      const selected = this.selected(
        filter,
        sqlFilter.params.recent as number | undefined,
      )
      const visual = this.vectorBranch(this.visual, [clip], selected, 'visual')
      const speech = this.vectorBranch(
        this.speech,
        [sentence],
        selected,
        'speech',
      )
      const lexical = this.read(() =>
        this.lexicalBranch(text, selected, sqlFilter),
      )
      const [visualHits, speechHits] = await Promise.all([visual, speech])
      return this.result(
        query,
        [visualHits, lexical, speechHits],
        selected,
        start,
      )
    })
  }

  async searchVideo(id: number, query: string): Promise<SceneMatch[]> {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error('invalid media id')
    const text = queryText(query)
    if (this.media.get(id)?.kind !== 1 || !this.mediaScenes.get(id)?.length)
      return []
    const encoded = text ? await this.encode(text) : null
    return this.snapshot(async () => {
      const heat = new Map(
        (this.mediaScenes.get(id) ?? []).map((scene) => [
          scene.id,
          {
            moment: {
              sceneId: scene.id,
              startMs: scene.start_ms,
              endMs: scene.end_ms,
              seekMs: scene.start_ms,
              sources: [],
              snippet: null,
              score: 0,
              match: false,
            } as SceneMatch,
            signals: [null, null, null] as (number | null)[],
          },
        ]),
      )
      if (!encoded) return [...heat.values()].map((h) => h.moment)
      const [clip, sentence] = encoded
      const visual = this.visual.ranked(id, clip)
      const cutoff = relevanceCutoff(
        'visual',
        visual[0]?.score ?? -Infinity,
        visualBand.timeline,
      )
      for (const { index, score } of visual) {
        const entry = heat.get(this.visual.sceneIds[index]!)
        if (!entry || entry.signals[0] !== null) continue
        entry.signals[0] = score
        entry.moment.seekMs = this.visual.startMs[index]!
        if (score >= cutoff) entry.moment.sources.push('visual')
      }
      const lexical = this.lexicalVideo(id, text)
      for (const { index, score } of this.speech.ranked(id, sentence)) {
        const lexicalScore = lexical.get(this.speech.ids[index]!)
        for (const { scene } of this.targets(
          id,
          this.speech.startMs[index]!,
          this.speech.endMs[index]!,
        )) {
          const entry = heat.get(scene!.id)!
          if (entry.signals[1] === null) {
            entry.signals[1] = score
            if (score >= relevanceFloor.speech) {
              entry.moment.sources.push('speech')
              entry.moment.snippet = this.speech.text[index]!
            }
          }
          if (
            lexicalScore !== undefined &&
            lexicalScore > (entry.signals[2] ?? -Infinity)
          ) {
            entry.signals[2] = lexicalScore
            if (!entry.moment.sources.includes('text'))
              entry.moment.sources.push('text')
            entry.moment.snippet = this.speech.text[index]!
          }
        }
      }
      const entries = [...heat.values()]
      const lexicalMax = Math.max(0, ...lexical.values())
      // Sum cosine excess above the soft floors plus relative BM25, normalize by the best
      // scene: continuous heat preserves shared strong speech across overlapping scenes.
      const scores = entries.map(
        ({ signals }) =>
          Math.max(0, (signals[0] ?? 0) - relevanceFloor.visual) +
          Math.max(0, (signals[1] ?? 0) - relevanceFloor.speech) +
          (signals[2] ?? 0) / (lexicalMax || 1),
      )
      const max = Math.max(...scores)
      return entries.map(({ moment }, index) => ({
        ...moment,
        seekMs:
          moment.sources.length && !moment.sources.includes('visual')
            ? moment.startMs
            : moment.seekMs,
        score: max > 0 ? scores[index]! / max : 0,
        match: moment.sources.length > 0,
      }))
    })
  }

  private lexicalVideo(id: number, query: string): Map<number, number> {
    if (this.videoFts?.mediaId !== id) {
      this.videoFts?.db.close()
      // BM25 computes corpus statistics. A single-video FTS cache keeps those local too;
      // a media-filtered join to the library FTS still visits other videos' term postings.
      // SQLite FTS5 §5.1.1 (Node 24.22): https://sqlite.org/fts5.html#the_bm25_function
      const db = new DatabaseSync(':memory:')
      db.exec('create virtual table segment using fts5(text); begin')
      const insert = db.prepare('insert into segment(rowid, text) values(?, ?)')
      this.read(() => {
        for (const row of this.db
          .prepare(
            'select id, text from transcript where media_id = ? and generation = ?',
          )
          .iterate(id, GENERATION.speech))
          insert.run(row.id!, row.text!)
      })
      db.exec('commit')
      this.videoFts = { mediaId: id, db }
    }
    return new Map(
      (
        this.videoFts.db
          .prepare('select rowid, rank from segment where segment match ?')
          .all(ftsQuery(query)) as { rowid: number; rank: number }[]
      ).map((row) => [row.rowid, -row.rank]),
    )
  }

  private async encode(text: string): Promise<[Float32Array, Float32Array]> {
    let encoded = this.queryVectors.get(text)
    if (encoded) this.queryVectors.delete(text)
    else {
      encoded = await Promise.all([
        this.encoders.clip(text),
        this.encoders.sentence(text),
      ])
      if (
        encoded.some(
          (v) => !(v instanceof Float32Array) || !v.every(Number.isFinite),
        )
      )
        throw new Error('invalid query embedding')
    }
    this.queryVectors.set(text, encoded)
    if (this.queryVectors.size > 32)
      this.queryVectors.delete(this.queryVectors.keys().next().value!)
    return encoded
  }

  async similar(id: number, filter: Filter): Promise<SearchResult> {
    const start = performance.now()
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error('invalid media id')
    const sqlFilter = filterSql(filter)
    return this.snapshot(async () => {
      const selected = this.selected(
        filter,
        sqlFilter.params.recent as number | undefined,
      )
      const candidates = new Set(selected)
      candidates.delete(id)
      return this.result(
        '',
        await Promise.all([
          this.vectorBranch(
            this.visual,
            this.visual.queries(id),
            candidates,
            'visual',
            false,
          ),
          this.vectorBranch(
            this.speech,
            this.speech.queries(id),
            candidates,
            'speech',
            false,
          ),
        ]),
        selected,
        start,
      )
    })
  }

  private targets(
    mediaId: number,
    start: number | null,
    end: number | null,
  ): Target[] {
    if (this.media.get(mediaId)!.kind === 0) return [{ mediaId, scene: null }]
    const scenes = this.mediaScenes.get(mediaId) ?? []
    if (start === null) return scenes.map((scene) => ({ mediaId, scene }))
    // Scene windows are ordered and non-overlapping; skip straight to the first overlap.
    let lo = 0
    let hi = scenes.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (scenes[mid]!.end_ms <= start) lo = mid + 1
      else hi = mid
    }
    const targets: Target[] = []
    for (let i = lo; i < scenes.length; i++) {
      const scene = scenes[i]!
      if (start === end ? scene.start_ms > start : scene.start_ms >= end!) break
      targets.push({ mediaId, scene })
    }
    return targets
  }

  private async vectorBranch(
    table: Vectors,
    queries: Float32Array[],
    selected: Set<number>,
    source: 'visual' | 'speech',
    gated = true,
  ) {
    const branch = new Map<string, Evidence>()
    if (!queries.length) return branch
    const allowed = table.mask(selected)
    const scores = new Map<number, number>()
    // Similarity uses max across source samples, preserving short events rather than averaging them away.
    for (const query of queries)
      for (const hit of await this.scanner.scan(table, query, allowed))
        scores.set(
          hit.index,
          Math.max(scores.get(hit.index) ?? -Infinity, hit.score),
        )
    const hits = [...scores]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 200)
    const cutoff = relevanceCutoff(
      source,
      hits[0]?.[1] ?? -Infinity,
      visualBand.global,
    )
    for (const [index, score] of hits) {
      if (gated && score < cutoff) continue
      const mediaId = table.mediaIds[index]!
      let targets: Target[]
      if (source === 'visual' && this.media.get(mediaId)!.kind === 1) {
        const scene = this.scenes.get(table.sceneIds[index]!)
        targets = scene ? [{ mediaId, scene }] : []
      } else
        targets = this.targets(
          mediaId,
          table.startMs[index]!,
          table.endMs[index]!,
        )
      for (const target of targets)
        this.vote(
          branch,
          target,
          source,
          source === 'visual' ? { score, ms: table.startMs[index]! } : null,
          source === 'speech'
            ? { startMs: table.startMs[index]!, text: table.text[index]! }
            : null,
        )
    }
    return branch
  }

  private lexicalBranch(
    query: string,
    selected: Set<number>,
    filter: ReturnType<typeof filterSql>,
  ) {
    const branch = new Map<string, Evidence>()
    const match = ftsQuery(query)
    const speech = this.db
      .prepare(`select t.media_id, t.start_ms, t.end_ms, t.text, transcript_fts.rank
      from transcript_fts join transcript t on t.id = transcript_fts.rowid join media m on m.id = t.media_id
      where transcript_fts match $query and t.generation = $generation and ${filter.where}
      order by transcript_fts.rank limit 200`)
      .all({
        ...filter.params,
        query: match,
        generation: GENERATION.speech,
      }) as Lexical[]
    const files = this.db
      .prepare(`select f.media_id, null as start_ms, null as end_ms, null as text, file_fts.rank
      from file_fts join file f on f.id = file_fts.rowid join media m on m.id = f.media_id
      where file_fts match $query and ${filter.where} order by file_fts.rank limit 200`)
      .all({ ...filter.params, query: match }) as Lexical[]
    for (const row of [...speech, ...files]
      .sort((a, b) => a.rank - b.rank || a.media_id - b.media_id)
      .slice(0, 200)) {
      if (!selected.has(row.media_id)) continue
      for (const target of this.targets(row.media_id, row.start_ms, row.end_ms))
        this.vote(
          branch,
          target,
          'text',
          null,
          row.text === null ? null : { startMs: row.start_ms!, text: row.text },
        )
    }
    return branch
  }

  private vote(
    branch: Map<string, Evidence>,
    target: Target,
    source: MatchSource,
    sample: Evidence['sample'],
    segment: Evidence['segment'],
  ) {
    const id = key(target)
    const existing = branch.get(id)
    if (!existing)
      branch.set(id, { target, sources: new Set([source]), sample, segment })
    else existing.segment ??= segment
  }

  private result(
    query: string,
    branches: Map<string, Evidence>[],
    selected: Set<number>,
    start: number,
  ): SearchResult {
    const fused = new Map<string, Ranked>()
    for (const branch of branches) {
      let rank = 0
      for (const [id, evidence] of branch) {
        const score = 1 / (60 + ++rank)
        const previous = fused.get(id)
        if (!previous)
          fused.set(id, {
            ...evidence,
            sources: new Set(evidence.sources),
            score,
          })
        else {
          previous.score += score
          for (const source of evidence.sources) previous.sources.add(source)
          previous.sample ??= evidence.sample
          previous.segment ??= evidence.segment
        }
      }
    }
    const ranked = [...fused.values()].sort(
      (a, b) => b.score - a.score || a.target.mediaId - b.target.mediaId,
    )
    const images: SearchResult['images'] = []
    const videoGroups = new Map<number, Ranked[]>()
    for (const hit of ranked) {
      if (!hit.target.scene) images.push({ mediaId: hit.target.mediaId })
      else {
        const group = videoGroups.get(hit.target.mediaId) ?? []
        group.push(hit)
        videoGroups.set(hit.target.mediaId, group)
      }
    }
    const videos = [...videoGroups].map(([mediaId, hits]) => ({
      mediaId,
      moments: this.moments(hits),
    }))
    const pending = { images: 0, videos: 0 }
    for (const id of this.pending)
      if (selected.has(id))
        pending[this.media.get(id)!.kind === 0 ? 'images' : 'videos']++
    return { query, images, videos, pending, tookMs: performance.now() - start }
  }

  private moments(hits: Ranked[]): Moment[] {
    const positions = new Map(
      this.mediaScenes
        .get(hits[0]!.target.mediaId)!
        .map((scene, index) => [scene.id, index]),
    )
    const groups: { start: number; end: number; hits: Ranked[] }[] = []
    for (const hit of hits.sort(
      (a, b) => a.target.scene!.start_ms - b.target.scene!.start_ms,
    )) {
      const scene = hit.target.scene!
      const previous = groups.at(-1)
      if (
        previous &&
        positions.get(scene.id) ===
          positions.get(previous.hits.at(-1)!.target.scene!.id)! + 1 &&
        scene.start_ms - previous.end < 2000 &&
        scene.end_ms - previous.start <= maxMomentMs
      ) {
        previous.end = Math.max(previous.end, scene.end_ms)
        previous.hits.push(hit)
      } else
        groups.push({ start: scene.start_ms, end: scene.end_ms, hits: [hit] })
    }
    return groups
      .map((group) => {
        const best = group.hits.reduce((a, b) => (a.score >= b.score ? a : b))
        const visual = group.hits
          .filter((h) => h.sample)
          .sort((a, b) => b.sample!.score - a.sample!.score)[0]
        const spoken = [...group.hits]
          .sort((a, b) => b.score - a.score)
          .find((h) => h.segment)
        const representative = spoken ?? visual ?? best
        const sources = new Set(group.hits.flatMap((h) => [...h.sources]))
        return {
          score: best.score,
          moment: {
            sceneId: representative.target.scene!.id,
            startMs: group.start,
            endMs: group.end,
            seekMs:
              spoken?.segment?.startMs ?? visual?.sample?.ms ?? group.start,
            sources: [...sources],
            snippet: spoken?.segment?.text ?? null,
          },
        }
      })
      .sort((a, b) => b.score - a.score)
      .map((g) => g.moment)
  }
}
