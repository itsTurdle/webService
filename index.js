const express = require('express')
const axios = require('axios')
const cors = require('cors')

const robloxCookie = process.env.ROBLOX_COOKIE
const port = process.env.PORT || 3000
const proxies = [
  'http://kouxcfva:s6cr6375gsfg@198.23.239.134:6540',
  'http://kouxcfva:s6cr6375gsfg@207.244.217.165:6712',
  'http://kouxcfva:s6cr6375gsfg@107.172.163.27:6543',
  'http://kouxcfva:s6cr6375gsfg@23.94.138.75:6349',
  'http://kouxcfva:s6cr6375gsfg@216.10.27.159:6837',
  'http://kouxcfva:s6cr6375gsfg@136.0.207.84:6661',
  'http://kouxcfva:s6cr6375gsfg@64.64.118.149:6732',
  'http://kouxcfva:s6cr6375gsfg@142.147.128.93:6593',
  'http://kouxcfva:s6cr6375gsfg@104.239.105.125:6655',
  'http://kouxcfva:s6cr6375gsfg@173.0.9.70:5653'
]
const scanCount = 3
const axiosInstances = proxies.map(proxy => {
  const url = new URL(proxy)
  return axios.create({
    proxy: {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: parseInt(url.port, 10),
      auth: url.username ? { username: url.username, password: url.password } : undefined
    },
    timeout: 10000,
    headers: {
      Cookie: `.ROBLOSECURITY=${robloxCookie}`,
      'User-Agent': 'Roblox/WinInet'
    }
  })
})

async function getAvatarLinks(tokens) {
  if (tokens.length === 0) return []
  const batch = tokens.map(token => ({
    token,
    type: 'AvatarHeadshot',
    size: '100x100',
    format: 'Png',
    isCircular: true
  }))
  const url = 'https://thumbnails.roblox.com/v1/batch'
  for (const inst of axiosInstances.slice().sort(() => Math.random() - 0.5)) {
    try {
      const response = await inst.post(url, batch)
      return (response.data.data || []).map(item => item.imageUrl)
    } catch (err) {
      if (err.response && err.response.status === 429) continue
      break
    }
  }
  return []
}

const pageCursorMap = {}
const app = express()
app.use(cors())

app.get('/servers/:placeId/:pageNumber', async (req, res) => {
  const placeId = req.params.placeId
  const pageNumber = parseInt(req.params.pageNumber, 10)
  if (!pageCursorMap[placeId]) pageCursorMap[placeId] = {}
  const prevCursor = pageNumber === 1 ? 'initial' : pageCursorMap[placeId][pageNumber - 1]
  const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${
    prevCursor && prevCursor !== 'initial' ? `&cursor=${prevCursor}` : ''
  }`

  try {
    const instances = axiosInstances
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, scanCount)
    const results = await Promise.allSettled(instances.map(inst => inst.get(url)))

    const localCache = {}
    let nextCursor = null

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const data = r.value.data
        if (!nextCursor && data.nextPageCursor) nextCursor = data.nextPageCursor
        ;(data.data || []).forEach(s => {
          const id = s.id
          if (!localCache[id]) {
            localCache[id] = {
              id,
              maxPlayers: s.maxPlayers,
              playing: s.playing,
              ping: s.ping,
              fps: s.fps,
              tokens: new Set(s.playerTokens || [])
            }
          } else {
            s.playerTokens?.forEach(t => localCache[id].tokens.add(t))
            localCache[id].playing = s.playing
          }
        })
      }
    }

    pageCursorMap[placeId][pageNumber] = nextCursor

    const servers = await Promise.all(
      Object.values(localCache).map(async server => {
        const tokens = Array.from(server.tokens)
        const avatarLinks = await getAvatarLinks(tokens)
        return {
          id: server.id,
          maxPlayers: server.maxPlayers,
          playing: server.playing,
          ping: server.ping,
          fps: server.fps,
          avatarLinks
        }
      })
    )

    res.json({ servers, nextPageCursor: nextCursor })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
