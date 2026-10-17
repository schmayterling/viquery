const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { mediaTools } = await import(`${wt}/src/compute/media.ts`)
const tools = mediaTools({ ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' })
let peak = 0
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 20)
const t = performance.now()
const probe = await tools.probe(process.argv[2])
const spans = await tools.audio(process.argv[2], probe.durationMs)
clearInterval(timer)
peak = Math.max(peak, process.memoryUsage().rss)
console.log(JSON.stringify({ durationMin: probe.durationMs / 60000, spans: spans.length, longestSpanMin: Math.max(...spans.map((s) => s.samples.length / 16000 / 60)), peakRssMB: Math.round(peak / 1048576), pcmMB: Math.round(probe.durationMs / 1000 * 16000 * 4 / 1048576), seconds: Math.round((performance.now() - t) / 1000) }))
