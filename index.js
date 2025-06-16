const express = require('express');
const axios = require('axios');
const cors = require('cors');
const pLimit = require('p-limit');

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

// Create axios instance for each proxy
function axiosWithProxy(proxy) {
    const url = new URL(proxy);
    return axios.create({
        proxy: {
            protocol: url.protocol.replace(':',''),
            host: url.hostname,
            port: +url.port,
            auth: url.username ? { username: url.username, password: url.password } : undefined,
        },
        timeout: 8000,
        headers: {
            Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`
        }
    });
}

const axiosProxies = proxies.map(axiosWithProxy);

// Helper to fetch one page of servers
async function fetchServers(placeId, cursor, proxyIdx) {
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    return axiosProxies[proxyIdx].get(url).then(r=>r.data);
}

// Helper to shuffle array (to avoid proxy cache/collision patterns)
function shuffle(arr) {
    let m = arr.length, t, i;
    while (m) {
        i = Math.floor(Math.random() * m--);
        t = arr[m], arr[m] = arr[i], arr[i] = t;
    }
    return arr;
}

app.get('/servers/:placeId/:page', async (req, res) => {
    try {
        const { placeId, page } = req.params;
        let cursor = null;
        let pageNum = 1;
        let targetPage = parseInt(page) || 1;

        // Step 1: Get the requested server page
        let serversPage = null;
        while (pageNum <= targetPage) {
            const proxyIdx = (pageNum-1) % proxies.length;
            serversPage = await fetchServers(placeId, cursor, proxyIdx);
            cursor = serversPage.nextPageCursor;
            pageNum++;
            if (!cursor && pageNum <= targetPage) throw new Error("Not enough pages.");
        }
        const servers = serversPage.data || serversPage.servers;
        if (!Array.isArray(servers)) return res.status(400).json({error:"No servers found"});
        
        // Step 2: For each server, brute-force token collection
        const limit = pLimit(proxies.length); // allow as many as proxies in parallel
        const out = [];

        await Promise.all(servers.map(async (server, idx) => {
            const playerCount = server.playing;
            const foundTokens = new Set();
            let tries = 0;
            let progressHistory = {};
            let proxiesOrder = [...Array(proxies.length).keys()];
            let tasks = [];
            let done = false;

            function logProgress() {
                if (!progressHistory[foundTokens.size]) {
                    progressHistory[foundTokens.size] = true;
                    console.log(`[${server.id}] Collected: ${foundTokens.size}/${playerCount}`);
                }
            }

            while (foundTokens.size < playerCount && tries < 40 && !done) {
                proxiesOrder = shuffle(proxiesOrder);
                // Kick off N requests at once (N = proxies.length)
                tasks = proxiesOrder.map(proxyIdx => limit(async () => {
                    if (foundTokens.size >= playerCount || done) return;
                    try {
                        const serversPageResp = await fetchServers(placeId, server.nextPageCursor, proxyIdx);
                        const allServers = serversPageResp.data || serversPageResp.servers || [];
                        const matching = allServers.find(srv => srv.id === server.id);
                        if (matching && Array.isArray(matching.playerTokens)) {
                            let prev = foundTokens.size;
                            for (const token of matching.playerTokens) foundTokens.add(token);
                            if (foundTokens.size > prev) logProgress();
                            if (foundTokens.size >= playerCount) done = true;
                        }
                    } catch (err) { /* ignore errors, continue */ }
                }));
                await Promise.all(tasks);
                tries++;
            }

            out.push({
                id: server.id,
                playing: playerCount,
                tokens: Array.from(foundTokens)
            });
            console.log(`[${server.id}] Final: ${foundTokens.size}/${playerCount} tokens (${foundTokens.size === playerCount ? "COMPLETE":"INCOMPLETE"})`);
        }));

        res.json({servers: out});
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
