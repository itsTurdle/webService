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

let proxyIndex = 0;
function getNextProxy() {
    const proxy = proxies[proxyIndex];
    proxyIndex = (proxyIndex + 1) % proxies.length;
    return proxy;
}

function axiosWithProxy(proxy) {
    // Split for http(s)://user:pass@host:port
    const url = new URL(proxy);
    return axios.create({
        proxy: {
            protocol: url.protocol.replace(':',''),
            host: url.hostname,
            port: +url.port,
            auth: url.username ? { username: url.username, password: url.password } : undefined,
        },
        timeout: 10000,
        headers: {
            Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`
        }
    });
}

app.get('/servers/:placeId/:page', async (req, res) => {
    try {
        const { placeId, page } = req.params;
        let cursor = null;
        let pageNum = 1;
        let targetPage = parseInt(page) || 1;

        // Fetch the desired server page, paging through until correct page is reached
        let serversPage = null;
        while (pageNum <= targetPage) {
            const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
            const instance = axiosWithProxy(getNextProxy());
            const resp = await instance.get(url);
            serversPage = resp.data;
            cursor = serversPage.nextPageCursor;
            pageNum++;
            if (!cursor && pageNum <= targetPage) throw new Error("Not enough pages.");
        }
        // Now serversPage.servers is your server list for that page
        const output = [];
        for (const server of serversPage.data || serversPage.servers) {
            const playerCount = server.playing;
            const foundTokens = new Set();
            let attempts = 0;
            let maxAttempts = 20; // avoid infinite loops on dead proxies

            while (foundTokens.size < playerCount && attempts < maxAttempts) {
                const proxy = getNextProxy();
                const instance = axiosWithProxy(proxy);

                try {
                    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Asc&excludeFullGames=false&cursor=${serversPage.nextPageCursor || ''}`;
                    const resp = await instance.get(url);
                    // Try to find the correct server entry
                    const servers = resp.data.data || resp.data.servers || [];
                    const s = servers.find(srv => srv.id === server.id);
                    if (s && Array.isArray(s.playerTokens)) {
                        for (const token of s.playerTokens) {
                            foundTokens.add(token);
                        }
                    }
                } catch (err) {
                    // Ignore single proxy error, rotate to next
                }
                attempts++;
            }

            output.push({
                id: server.id,
                playing: playerCount,
                tokens: Array.from(foundTokens)
            });
        }

        res.json({servers: output});
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
