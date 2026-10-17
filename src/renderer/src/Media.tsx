import { FolderOpen } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { type Folder, type MediaItem, mediaUrl } from '../../shared/api'
import { hideBroken } from './Grid'

export const originalAvailable = (id: number) =>
  fetch(mediaUrl.original(id), { method: 'HEAD' }).then(
    (r) => r.ok,
    () => false,
  )

export function MediaFailure({
  item,
  folder,
  available,
}: {
  item: MediaItem
  folder?: Folder | undefined
  available: boolean
}) {
  return (
    <div className="missing" role="status">
      <img src={mediaUrl.thumb(item.id)} alt="" onError={hideBroken} />
      <p>
        {available
          ? `This format cannot ${item.kind === 'image' ? 'display' : 'play'} here. Open the original in another app.`
          : folder?.state === 'offline'
            ? `${folder.name} isn't connected. Connect the drive to open the original.`
            : 'The original moved or was deleted.'}
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => window.viquery.reveal(item.id)}
      >
        <FolderOpen aria-hidden="true" /> Show original
      </button>
    </div>
  )
}

export function QuickVideo({
  item,
  folder,
  start,
}: {
  item: MediaItem
  folder: Folder | undefined
  start: number
}) {
  const [available, setAvailable] = useState<boolean | null>(null)
  if (available !== null)
    return <MediaFailure item={item} folder={folder} available={available} />
  return (
    <video
      src={mediaUrl.original(item.id)}
      poster={mediaUrl.thumb(item.id)}
      muted
      autoPlay={!matchMedia('(prefers-reduced-motion: reduce)').matches}
      loop
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = start / 1000
      }}
      onError={() => void originalAvailable(item.id).then(setAvailable)}
    />
  )
}

export function OriginalImage({
  item,
  folder,
  style,
}: {
  item: MediaItem
  folder?: Folder | undefined
  style?: CSSProperties
}) {
  const [source, setSource] = useState<'original' | 'preview'>('original')
  const [available, setAvailable] = useState<boolean | null>(null)
  if (available !== null)
    return <MediaFailure item={item} folder={folder} available={available} />
  return (
    <img
      src={
        source === 'original'
          ? mediaUrl.original(item.id)
          : mediaUrl.preview(item.id)
      }
      alt={item.name}
      decoding="async"
      draggable={false}
      style={style}
      onError={() => {
        if (source === 'original') setSource('preview')
        else void originalAvailable(item.id).then(setAvailable)
      }}
    />
  )
}
