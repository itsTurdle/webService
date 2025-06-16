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

// Create axios instances for all proxies
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

async function fetchServers(placeId, cursor, axiosInstance) {
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    try {
        const response = await axiosInstance.get(url);
        return response.data;
    } catch (err) {
        // console.log('fetchServers error:', err.message);
        return null;
    }
}

app.get('/servers/:placeId/:page', async (req, res) => {
    try {
        const { placeId, page } = req.params;
        let cursor = null;
        let pageNum = 1;
        let targetPage = parseInt(page) || 1;

        // Step 1: Fetch the desired page of servers
        let serversPage = null;
        while (pageNum <= targetPage) {
            let proxyIdx = (pageNum-1) % proxies.length;
            serversPage = await fetchServers(placeId, cursor, axiosInstances[proxyIdx]);
            if (!serversPage) throw new Error("Failed to get servers page");
            cursor = serversPage.nextPageCursor;
            pageNum++;
            if (!cursor && pageNum <= targetPage) throw new Error("Not enough pages.");
        }

        const servers = serversPage.data || serversPage.servers;
        if (!Array.isArray(servers)) return res.status(400).json({ error: "No servers found" });

        const results = [];

        for (const server of servers) {
            const { id, playing } = server;
            let tokens = new Set();
            let tries = 0;
            let maxTries = 100;
            let progress = 0;

            // Print initial status
            console.log(`\n[${id}] Target tokens: ${playing}`);
            while (tokens.size < playing && tries < maxTries) {
                // Try all proxies in random order each round
                const indices = proxies.map((_, i) => i).sort(() => Math.random() - 0.5);
                for (const idx of indices) {
                    if (tokens.size >= playing) break;
                    // Always fetch the *same* page for max coverage
                    let pageData = await fetchServers(placeId, serversPage.nextPageCursor, axiosInstances[idx]);
                    if (!pageData) continue;
                    let batch = pageData.data || pageData.servers || [];
                    let foundServer = batch.find(s => s.id === id);
                    if (foundServer && Array.isArray(foundServer.playerTokens)) {
                        let before = tokens.size;
                        foundServer.playerTokens.forEach(tok => tokens.add(tok));
                        if (tokens.size > before) {
                            console.log(`[${id}] Progress: ${tokens.size}/${playing} | Proxy: #${idx+1} (${proxies[idx].split('@')[1]})`);
                        }
                    }
                }
                tries++;
            }
            if (tokens.size < playing) {
                console.log(`[${id}] Gave up after ${tries} tries: got ${tokens.size}/${playing}`);
            } else {
                console.log(`[${id}] COMPLETE: ${tokens.size}/${playing} unique tokens`);
            }
            results.push({ id, playing, tokens: Array.from(tokens) });
        }

        res.json({ servers: results });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
