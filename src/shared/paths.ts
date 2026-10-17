// on-disk layout under <userData>/library. shared so main (protocol), catalog and compute agree.
import { join } from 'node:path'

const shard = (id: number) => (id % 256).toString(16).padStart(2, '0')

export function dataPaths(root: string) {
  return {
    root,
    db: join(root, 'viquery.db'),
    thumb: (id: number) => join(root, 'thumbs', shard(id), `${id}.webp`),
    preview: (id: number) => join(root, 'previews', shard(id), `${id}.webp`),
    sprite: (id: number) => join(root, 'sprites', shard(id), `${id}.webp`),
    frame: (id: number, ms: number) =>
      join(root, 'frames', shard(id), String(id), `${ms}.webp`),
    frames: (id: number) => join(root, 'frames', shard(id), String(id)),
  }
}

export type DataPaths = ReturnType<typeof dataPaths>
