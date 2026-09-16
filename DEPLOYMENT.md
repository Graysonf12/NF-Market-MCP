# Deploying nfl-market-mcp-server (GitHub → Render → Claude)

No API keys and no paid plans — the same setup as the FEMA, Municode and Parcel-GIS connectors.

## 1. GitHub
1. Create a repository, e.g. `NFL-Market-mcp` (private is fine).
2. Upload everything in this folder except `node_modules/` and `dist/`
   ("Add file → Upload files", or github.dev). If `.gitignore` gets skipped, create it with
   `node_modules/`, `dist/`, `.env` on three lines.

## 2. Render
1. **New → Web Service** → pick the repo.
2. Runtime **Node** · Build `npm install && npm run build` · Start `npm start` · Instance **Free**.
3. Optional environment variable: `NWS_USER_AGENT` = `nfl-market-mcp (your-email)` (the Weather
   Service asks apps to identify themselves).
4. **Create Web Service** → wait for **Live**. Settings → Health Check Path `/`.
5. Open `https://<service>.onrender.com/` → expect `"status":"ok"`, `"api_keys":"none"`, 13 tools.
6. Free services sleep when idle; the first call after a nap can take about 50 seconds.

## 3. Claude
- Individual (Pro/Max): **Customize → Connectors → + → Add custom connector** → URL
  `https://<service>.onrender.com/mcp` → **Add**.
- Team/Enterprise: an owner adds it under **Organization settings → Connectors → Add → Custom → Web**;
  members then **Connect** it under **Customize → Connectors**.
- In a chat: **+ → Connectors** → switch it on.

## 4. First checks
Ask Claude to run `market_sources_list`, `kalshi_list_games`, and `espn_dk_game_lines` for this week,
or run `node test/live-test.mjs https://<service>.onrender.com/mcp`.

## Updating
Edit on GitHub and commit — Render redeploys automatically. New Kalshi series are a one-line
registry change in `src/registry.ts`.
