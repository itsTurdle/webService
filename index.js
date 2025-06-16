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

const app = express()
app.use(cors())
app.use(express.json())

function createAxiosInstance(proxy) {
  const url = new URL(proxy)
  return axios.create({
    proxy: {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: parseInt(url.port, 10),
      auth: url.username
        ? { username: url.username, password: url.password }
        : undefined
    },
    timeout: 10000,
    headers: {
      Cookie: `.ROBLOSECURITY=${robloxCookie}`,
      'User-Agent': 'Roblox/WinInet'
    }
  })
}

const axiosInstances = proxies.map(createAxiosInstance)

app.post('/scan/:placeId', async (req, res) => {
  const placeId = req.params.placeId
  const cursor = req.body.cursor || 'initial'
  try {
    const instances = axiosInstances
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, scanCount)
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${
      cursor !== 'initial' ? `&cursor=${cursor}` : ''
    }`
    console.log(`[${placeId}] scanning ${scanCount} instances, cursor=${cursor}`)

    const localCache = {}
    let nextPageCursor = null

    const results = await Promise.allSettled(
      instances.map(inst => inst.get(url))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const data = result.value.data
        if (!nextPageCursor && data.nextPageCursor) {
          nextPageCursor = data.nextPageCursor
        }
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
      } else {
        console.warn(`[${placeId}] scan failed: ${result.reason.message}`)
      }
    }

    const servers = Object.values(localCache).map(s => ({
      id: s.id,
      maxPlayers: s.maxPlayers,
      playing: s.playing,
      ping: s.ping,
      fps: s.fps,
      tokens: Array.from(s.tokens)
    }))

    console.log(
      `[${placeId}] returning ${servers.length} servers, total tokens=${
        servers.reduce((acc, s) => acc + s.tokens.length, 0)
      }`
    )
    res.json({ servers, nextPageCursor })
  } catch (err) {
    console.error(`[${placeId}] error: ${err.message}`)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
