# AnimeGame

3D browser life-sim prototype for animegame.ru.

## Local Development

```bash
npm install
npm run dev
```

Client: http://localhost:5173
API: http://localhost:4000

## Current Features

- Registration and login with JWT.
- JSON persistence for users, coins, inventory, homes and chat history.
- 3D room with clickable movement, placed furniture/decor and stylized characters.
- Shop with furniture, decor, clothing and pets.
- Work activities that earn coins.
- Visiting other players' homes.
- Socket.IO realtime movement, chat, join/leave and object interaction events.
- One seamless street-to-outlands world with a checkpoint, forest, abandoned depot, quarry and old-city ruins.
- Persistent PvE expeditions with server-validated enemy health and ammunition, loot containers, enemy drops and extraction.
- Home stash, weapon/ammo purchases, crafting, loadout preparation, quests and skill upgrades.
- Realtime parties for up to four online players, cross-location invitations and leader-launched group expeditions.

The current expedition is a playable PvE vertical slice. Competitive PvP, shared
server-authoritative AI/combat and player corpse looting are deliberately not enabled
until movement, hits, ammunition and item ownership are fully authoritative on the server.

## Production Sketch

```bash
cd /var/www/animegame.ru
npm install
npm run build
npm run start
```

Use `deploy/nginx-animegame.ru.conf` for Nginx and `deploy/animegame-api.service` for systemd.
Replace `JWT_SECRET` with a long random value before public launch.
