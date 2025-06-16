const express = require('express');
const axios = require('axios');
const cors = require('cors');

// --- CONFIGURATION ---
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE; // IMPORTANT: Set this in your environment variables
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
const SCAN_COUNT = 3; // Number of parallel scans to perform on the target page

// --- INITIALIZATION ---
const app = express();
app.use(cors());
app.use(express.json());

// Helper to create a proxied Axios instance
function createAxiosInstance(proxy) {
    const url = new URL(proxy);
    return axios.create({
        proxy: {
            protocol: url.protocol.replace(':', ''),
            host: url.hostname,
            port: parseInt(url.port, 10),
            auth: url.username ? { username: url.username, password: url.password } : undefined,
        },
        timeout: 10000,
        headers: {
            'Cookie': `.ROBLOSECURITY=${ROBLOX_COOKIE}`,
            'User-Agent': 'Roblox/WinInet',
            'Content-Type': 'application/json'
        }
    });
}
const proxiedAxiosInstances = PROXIES.map(createAxiosInstance);

if (proxiedAxiosInstances.length < SCAN_COUNT) {
    throw new Error(`Configuration error: At least ${SCAN_COUNT} proxies are required.`);
}


// --- PRIMARY API ENDPOINT ---
app.get('/servers/:placeId/:pageNumber', async (req, res) => {
    const { placeId } = req.params;
    const pageNumber = parseInt(req.params.pageNumber, 10);

    if (isNaN(pageNumber) || pageNumber < 1) {
        return res.status(400).json({ error: "Page number must be a positive integer." });
    }

    let currentPage = 1;
    let cursor = null;
    const navigatorInstance = proxiedAxiosInstances[0]; // Use the first proxy to navigate

    try {
        // 1. Navigate to the starting cursor of the desired page
        console.log(`Navigating to page ${pageNumber} for Place ID: ${placeId}...`);
        while (currentPage < pageNumber) {
            const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
            const response = await navigatorInstance.get(url);
            cursor = response.data.nextPageCursor;
            if (!cursor) {
                console.warn(`Reached the end of server list before getting to page ${pageNumber}.`);
                return res.status(404).json({ error: `Page not found. The server list only has ${currentPage} pages.` });
            }
            currentPage++;
        }
        console.log(`Arrived at page ${pageNumber}. Current cursor: ${cursor || 'None'}`);

        // 2. Scan the target page with multiple proxies
        const instancesToUse = [...proxiedAxiosInstances].sort(() => 0.5 - Math.random()).slice(0, SCAN_COUNT);
        const targetUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;

        console.log(`Performing ${SCAN_COUNT} parallel scans on: ${targetUrl}`);
        const scanPromises = instancesToUse.map(instance => instance.get(targetUrl));
        const scanResults = await Promise.allSettled(scanPromises);

        // 3. Aggregate all unique tokens
        const allTokens = new Set();
        let finalNextPageCursor = null;

        for (const result of scanResults) {
            if (result.status === 'fulfilled' && result.value.data) {
                const pageData = result.value.data;
                const servers = pageData.data || [];
                
                // Set the next page cursor from the first successful request
                if (pageData.nextPageCursor && !finalNextPageCursor) {
                    finalNextPageCursor = pageData.nextPageCursor;
                }

                for (const server of servers) {
                    if (server.playerTokens && Array.isArray(server.playerTokens)) {
                        for (const token of server.playerTokens) {
                            allTokens.add(token);
                        }
                    }
                }
            } else if (result.status === 'rejected') {
                console.warn(`A proxy scan failed: ${result.reason.message}`);
            }
        }
        
        console.log(`Found ${allTokens.size} unique tokens on page ${pageNumber}.`);

        // 4. Format and return the response
        res.status(200).json({
            status: 200,
            response: {
                tokens: Array.from(allTokens),
                nextPageCursor: finalNextPageCursor
            }
        });

    } catch (error) {
        console.error("An error occurred during the process:", error.message);
        if (error.response) {
             console.error("Roblox API Error:", error.response.data);
        }
        return res.status(500).json({ error: "An internal server error occurred." });
    }
});


// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Roblox Token Aggregator is running on http://localhost:${PORT}`);
    if (!ROBLOX_COOKIE) {
        console.warn("Warning: ROBLOX_COOKIE environment variable is not set. Requests will likely fail.");
    }
});
