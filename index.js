const express = require('express');
const axios = require('axios');
const cors = require('cors');

// --- CONFIGURATION ---
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE; // IMPORTANT: Set this environment variable
const PORT = process.env.PORT || 3000;
const PROXIES = [
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

// --- INITIALIZATION ---
const app = express();
app.use(cors());
app.use(express.json());

// Helper to create an Axios instance with a specific proxy
function createAxiosInstance(proxy) {
    const url = new URL(proxy);
    return axios.create({
        proxy: {
            protocol: url.protocol.replace(':', ''),
            host: url.hostname,
            port: parseInt(url.port, 10),
            auth: url.username ? {
                username: url.username,
                password: url.password
            } : undefined,
        },
        timeout: 10000,
        headers: {
            'Cookie': `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
            'User-Agent': 'Roblox/WinInet',
            'Content-Type': 'application/json'
        }
    });
}

// Create a pool of Axios instances, one for each proxy
const axiosInstances = PROXIES.map(createAxiosInstance);

// --- API ENDPOINT ---
app.get('/find-player/:placeId/:targetToken', async (req, res) => {
    const {
        placeId,
        targetToken
    } = req.params;
    let {
        cursor
    } = req.query; // Optional: for paging

    if (!placeId || !targetToken) {
        return res.status(400).json({
            error: "Place ID and target player token are required."
        });
    }

    const robloxApiUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;

    // Select 3 unique random proxies for the scan
    if (axiosInstances.length < 3) {
        return res.status(500).json({
            error: "Not enough proxies configured. At least 3 are required."
        });
    }
    const selectedInstances = [...axiosInstances].sort(() => 0.5 - Math.random()).slice(0, 3);

    try {
        console.log(`Scanning Place ID: ${placeId} for Token: ...${targetToken.slice(-6)}`);
        console.log(`Using 3 proxies to scan URL: ${robloxApiUrl}`);

        // Perform 3 scans in parallel using different proxies
        const promises = selectedInstances.map(instance => instance.get(robloxApiUrl));
        const responses = await Promise.allSettled(promises);

        let foundServer = null;

        // Process the results from the 3 scans
        for (const result of responses) {
            if (result.status === 'fulfilled' && result.value.data) {
                const page = result.value.data;
                const servers = page.data || [];

                for (const server of servers) {
                    if (server.playerTokens && server.playerTokens.includes(targetToken)) {
                        console.log(`[SUCCESS] Found token in Server ID: ${server.id}`);
                        foundServer = {
                            id: server.id,
                            playing: server.playing,
                            playerTokens: server.playerTokens,
                            nextPageCursor: page.nextPageCursor
                        };
                        break; // Exit inner loop once found
                    }
                }
            } else if (result.status === 'rejected') {
                console.warn(`A proxy request failed: ${result.reason.message}`);
            }
            if (foundServer) break; // Exit outer loop if found
        }

        if (foundServer) {
            return res.json({
                status: 'found',
                server: foundServer
            });
        } else {
            const nextCursor = responses.find(r => r.status === 'fulfilled' && r.value.data.nextPageCursor)?.value.data.nextPageCursor;
            console.log("Token not found on this page.");
            return res.status(404).json({
                status: 'not_found',
                message: 'Target player token not found on this server page.',
                nextPageCursor: nextCursor || null
            });
        }

    } catch (error) {
        console.error("An unexpected error occurred:", error.message);
        res.status(500).json({
            error: "An internal server error occurred."
        });
    }
});

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Roblox Player Finder is running on http://localhost:${PORT}`);
    if (!ROBLOX_COOKIE) {
        console.warn("Warning: ROBLOX_COOKIE environment variable is not set. Requests to Roblox API will likely fail.");
    }
});
