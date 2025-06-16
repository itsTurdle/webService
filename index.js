const express = require('express');
const axios = require('axios');
const cors = require('cors');

const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;
const app = express();
app.use(cors());
app.use(express.json());

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
    const url = new URL(proxy);
    return axios.create({
        proxy: {
            protocol: url.protocol.replace(':', ''),
            host: url.hostname,
            port: +url.port,
            auth: url.username ? { username: url.username, password: url.password } : undefined,
        },
        timeout: 7000,
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
        totalFound += s.tokens.size;
        totalNeeded += s.playing;
    }
    console.log(`[PAGE PROGRESS] ${totalFound}/${totalNeeded} tokens collected`);
}

app.get('/servers/:placeId/:page', async (req, res) => {
    try {
        const { placeId, page } = req.params;
        let cursor = null;
        let pageNum = 1;
        let targetPage = parseInt(page) || 1;

        // Step 1: Fetch the desired page of servers (with any proxy)
        let serversPage = null;
        while (pageNum <= targetPage) {
            let proxyIdx = 0;
            const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
            serversPage = await axiosInstances[proxyIdx].get(url).then(r=>r.data).catch(e=>null);
            if (!serversPage) throw new Error("Failed to get servers page");
            cursor = serversPage.nextPageCursor;
            pageNum++;
            if (!cursor && pageNum <= targetPage) throw new Error("Not enough pages.");
        }

        const servers = (serversPage.data || serversPage.servers || []);
        if (!Array.isArray(servers) || !servers.length) return res.status(400).json({ error: "No servers found" });

        // One token set per server
        let state = {};
        for (const server of servers) {
            state[server.id] = {
                id: server.id,
                playing: server.playing,
                tokens: new Set(),
                finished: false
            };
        }
        let finishedCount = 0;
        const throttle = 2000; // ms between requests

        // Progress printer
        const interval = setInterval(() => printPageProgress(state), 5000);

        let proxyIdx = 0;

        while (finishedCount < servers.length) {
            const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
            try {
                let pageData = await axiosInstances[proxyIdx].get(url).then(r=>r.data);
                if (pageData && Array.isArray(pageData.data || pageData.servers)) {
                    let batch = (pageData.data || pageData.servers);
                    for (const s of batch) {
                        if (!state[s.id] || state[s.id].finished) continue;
                        let before = state[s.id].tokens.size;
                        if (Array.isArray(s.playerTokens)) {
                            for (const tok of s.playerTokens) state[s.id].tokens.add(tok);
                        }
                        if (state[s.id].tokens.size > before) {
                            // Optionally: console.log(`[${s.id}] Progress: ${state[s.id].tokens.size}/${state[s.id].playing}`);
                        }
                        if (state[s.id].tokens.size >= state[s.id].playing && !state[s.id].finished) {
                            state[s.id].finished = true;
                            finishedCount++;
                            // Optionally: console.log(`[${s.id}] COMPLETE (${state[s.id].tokens.size}/${state[s.id].playing})`);
                        }
                    }
                }
                await sleep(throttle);
            } catch (e) {
                console.log(`[PROXY ERROR] Proxy #${proxyIdx+1} (${proxies[proxyIdx].split('@')[1]}) failed. Switching proxies...`);
                proxyIdx = (proxyIdx + 1) % proxies.length;
                // Optionally sleep a bit more to avoid instant re-hammering on ban
                await sleep(throttle * 2);
            }
        }

        clearInterval(interval);

        // Output results
        res.json({
            servers: Object.values(state).map(s => ({
                id: s.id,
                playing: s.playing,
                tokens: Array.from(s.tokens)
            }))
        });
    } catch (err) {
        if (err.response && err.response.data) {
            console.error("Roblox API error:", JSON.stringify(err.response.data));
            res.status(500).json({ error: err.response.data });
        } else {
            console.error("Server error:", err.message);
            res.status(500).json({ error: err.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
