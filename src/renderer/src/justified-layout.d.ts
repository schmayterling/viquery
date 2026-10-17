// https://github.com/flickr/justified-layout (isc) ships no types; only the options viquery uses.
declare module 'justified-layout' {
  type Box = {
    aspectRatio: number
    top: number
    left: number
    width: number
    height: number
  }
  type Config = {
    containerWidth: number
    containerPadding?: number
    boxSpacing?: number
    targetRowHeight?: number
    forceAspectRatio?: number | false
  }
  export default function justifiedLayout(
    aspects: number[],
    config: Config,
  ): { containerHeight: number; boxes: Box[] }
}
