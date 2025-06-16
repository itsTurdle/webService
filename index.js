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
        timeout: 8000,
        headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` }
    });
}
const axiosInstances = proxies.map(axiosWithProxy);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/servers/:placeId/:page', async (req, res) => {
    try {
        const { placeId, page } = req.params;
        const targetToken = req.query.targetToken;
        if (!targetToken) return res.status(400).json({ error: "targetToken is required as a query parameter" });

        let cursor = null;
        let pageNum = 1;
        let targetPage = parseInt(page) || 1;

        // Fetch the desired page of servers (with any proxy)
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

        let state = {};
        for (const server of servers) {
            state[server.id] = {
                id: server.id,
                found: false,
                attempts: 0
            };
        }
        let foundCount = 0;
        const throttle = 2000; // ms per request per proxy

        // Print progress every 5 seconds
        const interval = setInterval(() => {
            let total = Object.keys(state).length;
            let found = Object.values(state).filter(s => s.found).length;
            console.log(`[PAGE PROGRESS] Found ${found}/${total} servers with targetToken`);
        }, 5000);

        // Use only 3 proxies at a time
        let proxyIndex = 0;
        let activeProxies = 3;
        let proxyTasks = [];

        function startProxyWorker(idx) {
            return (async function worker() {
                while (foundCount < servers.length) {
                    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
                    try {
                        let pageData = await axiosInstances[idx].get(url).then(r=>r.data);
                        if (pageData && Array.isArray(pageData.data || pageData.servers)) {
                            let batch = (pageData.data || pageData.servers);
                            for (const s of batch) {
                                if (!state[s.id] || state[s.id].found) continue;
                                state[s.id].attempts++;
                                if (Array.isArray(s.playerTokens) && s.playerTokens.includes(targetToken)) {
                                    state[s.id].found = true;
                                    foundCount++;
                                    console.log(`[${s.id}] FOUND targetToken using Proxy #${idx+1} (${proxies[idx].split('@')[1]}) after ${state[s.id].attempts} attempts`);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`[PROXY #${idx+1}] (${proxies[idx].split('@')[1]}) error: ${e.message}`);
                        // On error, rotate to the next proxy
                        idx = (proxyIndex++ % proxies.length);
                    }
                    await sleep(throttle);
                }
            })();
        }

        // Start 3 workers
        for (let i = 0; i < 3; i++) {
            proxyTasks.push(startProxyWorker(i));
        }

        await Promise.all(proxyTasks);

        clearInterval(interval);

        res.json({
            servers: Object.values(state).map(s => ({
                id: s.id,
                found: s.found,
                attempts: s.attempts
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
