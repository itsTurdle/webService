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
const AVATAR_IMG_SIZE = "150x150"; // Avatar image size to use for matching

// --- INITIALIZATION ---
const app = express();
app.use(cors());
app.use(express.json());

// Create a single, non-proxied axios instance for general API calls
const baseAxios = axios.create({ timeout: 10000 });

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

// --- ROBLOX API HELPERS ---

async function getUserId(username) {
    const response = await baseAxios.post("https://users.roblox.com/v1/usernames/users", {
        usernames: [username],
        excludeBannedUsers: false
    });
    const user = response.data.data[0];
    if (!user) throw new Error("User not found");
    return user.id;
}

async function getTargetAvatarUrl(userId) {
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=${AVATAR_IMG_SIZE}&format=Png&isCircular=false`;
    const response = await baseAxios.get(url);
    const avatar = response.data.data[0];
    if (!avatar || !avatar.imageUrl) throw new Error("Could not get target avatar image");
    return avatar.imageUrl;
}

async function getAvatarUrlsFromTokens(tokens, axiosInstance) {
    if (!tokens || tokens.length === 0) return [];
    const batchRequest = tokens.map(token => ({
        token: token,
        type: "AvatarHeadshot",
        size: AVATAR_IMG_SIZE,
        format: "Png",
        isCircular: false
    }));
    const response = await axiosInstance.post("https://thumbnails.roblox.com/v1/batch", batchRequest);
    return response.data.data.map(item => item.imageUrl);
}


// --- PRIMARY API ENDPOINT ---
app.get('/find-by-username/:placeId/:username', async (req, res) => {
    const { placeId, username } = req.params;
    let { cursor } = req.query;

    if (!placeId || !username) {
        return res.status(400).json({ error: "Place ID and username are required." });
    }

    try {
        // 1. Get the target user's info first
        console.log(`Looking up user: ${username}`);
        const userId = await getUserId(username);
        const targetAvatarUrl = await getTargetAvatarUrl(userId);
        console.log(`Target Acquired: ${username} (ID: ${userId})`);
        console.log(`Target Avatar URL: ${targetAvatarUrl}`);

        // 2. Prepare to scan the server list with multiple proxies
        const serverListUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const instancesToUse = [...proxiedAxiosInstances].sort(() => 0.5 - Math.random()).slice(0, 3);
        
        console.log(`\nScanning Place ID ${placeId} with 3 proxies...`);

        // 3. Make parallel requests to the server list
        const serverPagePromises = instancesToUse.map(instance => instance.get(serverListUrl));
        const serverPageResults = await Promise.allSettled(serverPagePromises);

        let found = false;

        // 4. Process results and find the match
        for (const result of serverPageResults) {
            if (found) break; // Stop if already found in another parallel request
            if (result.status === 'rejected') {
                 console.warn(`A proxy request failed to get server list: ${result.reason.message}`);
                 continue;
            }

            const servers = result.value.data.data || [];
            for (const server of servers) {
                if (found) break;

                // Use a proxied instance for the batch thumbnail request too
                const randomProxy = instancesToUse[Math.floor(Math.random() * instancesToUse.length)];

                try {
                    const avatarUrls = await getAvatarUrlsFromTokens(server.playerTokens, randomProxy);
                    if (avatarUrls.includes(targetAvatarUrl)) {
                        found = true;
                        console.log(`[SUCCESS] Match found in Server ID: ${server.id}`);
                        return res.json({
                            status: 'found',
                            server: {
                                id: server.id,
                                playing: server.playing
                            },
                            nextPageCursor: result.value.data.nextPageCursor
                        });
                    }
                } catch (batchError) {
                    console.warn(`Could not get thumbnails for server ${server.id}: ${batchError.message}`);
                }
            }
        }
        
        // 5. If no match was found after all checks
        if (!found) {
            const nextCursor = serverPageResults.find(r => r.status === 'fulfilled')?.value?.data?.nextPageCursor;
            console.log("User not found on this page.");
            return res.status(404).json({
                status: 'not_found',
                message: 'User not found on this server page.',
                nextPageCursor: nextCursor || null
            });
        }

    } catch (error) {
        console.error("An error occurred during the search process:", error.message);
        return res.status(500).json({ error: error.message || "An internal server error occurred." });
    }
});


// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Roblox Player Finder (Corrected Logic) is running on http://localhost:${PORT}`);
    if (!ROBLOX_COOKIE) {
        console.warn("Warning: ROBLOX_COOKIE environment variable is not set. Proxied requests will fail.");
    }
});
