const express = require('express');
const axios = require('axios');
const cors = require('cors');

const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
if (!ROBLOX_COOKIE) {
  console.error("Error: ROBLOX_COOKIE env var not set");
  process.exit(1);
}

const proxies = [
  "http://kouxcfva:s6cr6375gsfg@198.23.239.134:6540",
  "http://kouxcfva:s6cr6375gsfg@207.244.217.165:6712",
  "http://kouxcfva:s6cr6375gsfg@107.172.163.27:6543",
  "http://kouxcfva:s6cr6375gsfg@23.94.138.75:6349",
  "http://kouxcfva:s6cr6375gsfg@216.10.27.159:6837",
  "http://kouxcfva:s6cr6375gsfg@136.0.207.84:6661",
  "http://kouxcfva:s6cr6375gsfg@64.64.118.149:6732",
  "http://kouxcfva:s6cr6375gsfg@142.147.128.93:6593",
  "http://kouxcfva:s6cr6375gsfg@104.239.105.125:6655",
  "http://kouxcfva:s6cr6375gsfg@173.0.9.70:5653"
];

function axiosWithProxy(proxy) {
  const p = new URL(proxy);
  return axios.create({
    proxy: {
      protocol: p.protocol.replace(':',''),
      host: p.hostname,
      port: +p.port,
      auth: p.username ? { username: p.username, password: p.password } : undefined,
    },
    timeout: 8000,
    headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` }
  });
}

const axiosInstances = proxies.map(axiosWithProxy);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printPageProgress(state) {
  let totalFound = 0, totalNeeded = 0;
  for (const s of Object.values(state)) {
    totalFound += s.found ? 1 : 0;
    totalNeeded += 1;
  }
  console.log(`[PAGE PROGRESS] ${totalFound}/${totalNeeded} servers found`);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/servers/:placeId/:page', async (req, res) => {
  try {
    const { placeId, page } = req.params;
    const targetToken = req.query.targetToken;
    if (!targetToken) {
      return res.status(400).json({ error: "targetToken query parameter is required" });
    }

    // 1) Fetch the desired page of servers
    let cursor = null;
    let serversPage = null;
    for (let pNum = 1; pNum <= (+page || 1); pNum++) {
      const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
      // use first proxy for initial pagination
      serversPage = await axiosInstances[0].get(url).then(r => r.data);
      if (!serversPage) throw new Error("Failed to fetch servers page");
      cursor = serversPage.nextPageCursor;
      if (!cursor && pNum < (+page || 1)) throw new Error("Not enough pages");
    }

    const serverList = Array.isArray(serversPage.data)
      ? serversPage.data
      : serversPage.servers;
    if (!serverList || !serverList.length) {
      return res.status(404).json({ error: "No servers found on that page" });
    }

    // 2) Initialize state
    let state = {};
    for (const srv of serverList) {
      state[srv.id] = { id: srv.id, found: false, attempts: 0 };
    }
    let foundCount = 0;
    const throttle = 2000;  // ms between requests per proxy

    // 3) Periodic page progress
    const progressInterval = setInterval(() => printPageProgress(state), 5000);

    // 4) Start 3 parallel proxy workers
    const workers = [];
    for (let i = 0; i < 3; i++) {
      workers.push((async function worker(proxyIdx) {
        while (foundCount < serverList.length) {
          const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
          try {
            const resp = await axiosInstances[proxyIdx].get(url);
            const batch = Array.isArray(resp.data.data)
              ? resp.data.data
              : resp.data.servers;
            for (const s of batch) {
              if (!state[s.id] || state[s.id].found) continue;
              state[s.id].attempts++;
              if (Array.isArray(s.playerTokens) && s.playerTokens.includes(targetToken)) {
                state[s.id].found = true;
                foundCount++;
                console.log(
                  `[${s.id}] FOUND token via Proxy #${proxyIdx+1} (${proxies[proxyIdx].split('@')[1]}) ` +
                  `after ${state[s.id].attempts} attempts`
                );
              }
            }
          } catch (e) {
            let msg = `[PROXY #${proxyIdx+1}] (${proxies[proxyIdx].split('@')[1]}) error: `;
            if (e.response) {
              msg += `Status ${e.response.status} ${e.response.statusText} on ${e.config.url}`;
              if (e.response.data) {
                const body = typeof e.response.data === 'string'
                  ? e.response.data
                  : JSON.stringify(e.response.data);
                msg += ` | Body: ${body.slice(0,200)}`;
              }
            } else if (e.request) {
              msg += `No response received for ${url}`;
            } else {
              msg += e.message;
            }
            console.log(msg);
            // do not advance proxyIdx here; keep using same proxy
          }
          await sleep(throttle);
        }
      })(i));
    }

    // Wait for all workers to finish
    await Promise.all(workers);
    clearInterval(progressInterval);

    // 5) Respond
    res.json({
      servers: Object.values(state).map(s => ({
        id: s.id,
        found: s.found,
        attempts: s.attempts
      }))
    });

  } catch (err) {
    console.error("Handler error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server proxy listening on port ${PORT}`));
