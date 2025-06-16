// Install dependencies:
// npm install express axios cors https-proxy-agent

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
if (!ROBLOX_COOKIE) {
  console.error("Error: set ROBLOX_COOKIE env var");
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

// create an HttpsProxyAgent for each proxy
const agents = proxies.map(proxyUrl => new HttpsProxyAgent(proxyUrl));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchServersPage(placeId, cursor, agent) {
  const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
  const resp = await axios.get(url, {
    httpsAgent: agent,
    headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` },
    timeout: 8000
  });
  return resp.data;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/servers/:placeId/:page', async (req, res) => {
  try {
    const placeId = req.params.placeId;
    const pageNumReq = parseInt(req.params.page, 10) || 1;
    const targetToken = req.query.targetToken;
    if (!targetToken) {
      return res.status(400).json({ error: "targetToken query param required" });
    }

    // 1) paginate to desired page
    let cursor = null, serversPage = null;
    for (let p = 1; p <= pageNumReq; p++) {
      serversPage = await fetchServersPage(placeId, cursor, agents[0]);
      if (!serversPage) throw new Error("Failed to fetch servers page");
      cursor = serversPage.nextPageCursor;
      if (!cursor && p < pageNumReq) throw new Error("Not enough pages");
    }

    const list = Array.isArray(serversPage.data) ? serversPage.data : serversPage.servers;
    if (!list || !list.length) {
      return res.status(404).json({ error: "No servers found" });
    }

    // 2) init state
    const state = {};
    list.forEach(s => {
      state[s.id] = { found: false, attempts: 0 };
    });
    let foundCount = 0;
    const throttle = 2000; // ms

    // 3) periodic page progress
    const progressInt = setInterval(() => {
      console.log(`[PAGE PROGRESS] ${foundCount}/${list.length} servers found`);
    }, 5000);

    // 4) start 3 parallel workers
    const workers = [];
    for (let i = 0; i < 3; i++) {
      workers.push((async function worker(idx) {
        while (foundCount < list.length) {
          try {
            const data = await fetchServersPage(placeId, cursor, agents[idx]);
            const batch = Array.isArray(data.data) ? data.data : data.servers;
            batch.forEach(s => {
              if (state[s.id] && !state[s.id].found) {
                state[s.id].attempts++;
                if (Array.isArray(s.playerTokens) && s.playerTokens.includes(targetToken)) {
                  state[s.id].found = true;
                  foundCount++;
                  console.log(
                    `[${s.id}] FOUND token via Proxy #${idx+1} (${proxies[idx].split('@')[1]}) ` +
                    `after ${state[s.id].attempts} attempts`
                  );
                }
              }
            });
          } catch (e) {
            let msg = `[PROXY #${idx+1}] (${proxies[idx].split('@')[1]}) error: `;
            if (e.response) {
              msg += `Status ${e.response.status} ${e.response.statusText}`;
              if (e.response.data) {
                const body = typeof e.response.data === 'string'
                  ? e.response.data
                  : JSON.stringify(e.response.data);
                msg += ` | Body: ${body.slice(0,200)}`;
              }
            } else if (e.request) {
              msg += `No response from Roblox`;
            } else {
              msg += e.message;
            }
            console.log(msg);
          }
          await sleep(throttle);
        }
      })(i));
    }

    await Promise.all(workers);
    clearInterval(progressInt);

    // 5) respond
    res.json({
      servers: list.map(s => ({
        id: s.id,
        found: state[s.id].found,
        attempts: state[s.id].attempts
      }))
    });

  } catch (err) {
    console.error("Handler error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
