const express = require('express');
const axios = require('axios');
const cors = require('cors');

const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/servers/:placeId', async (req, res) => {
  try {
    const { placeId } = req.params;
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`;

    const response = await axios.get(url, {
      headers: {
        Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`
      }
    });

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
