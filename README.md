# TryChat

A mobile AI chat app (iOS + Android, built with Expo / React Native) for any
OpenAI-compatible server — preconfigured for `http://169.58.133.158:20128/v1`.

## Features

- **Chat with any model on the server** — models are listed from `/v1/models`; pick a default in Settings or switch per chat.
- **Streaming replies** with a Stop button, Regenerate, Retry on error, copy / edit & resend.
- **Chat history** — every conversation is saved on the device; search, rename (tap the title or long-press) and delete.
- **Long-term memory** — the model saves facts about you (“remember that…”) and they're included in every chat. View, edit, add or delete them on the Memory screen.
- **Builder mode** — ask for apps, games, websites or tools; HTML/JS code blocks get a **▶ Preview** button that runs them right inside the app.
- **GitHub** — connect a personal access token and TryChat can list your repos, read files, commit file changes and open issues.
- **Your laptop** — run the small bridge on your computer and TryChat can list/read/write files and run commands there (tests, builds, scripts).
  Commands and changes show a **Run / Deny** card first; reads can run on their own (configurable).
- **Accounts & synced memory** — sign up / sign in; memories, chats, skills, MCP servers and preferences sync to every device on the same account (API keys and tokens stay on each device).
- **Sub-agents** — the model can send up to 5 helper agents to work in parallel (research, comparisons, splitting big jobs). They can read and run code but can't run commands or make changes.
- **Run code in the app** — JavaScript and Python (Pyodide, with numpy/pandas) run on the phone; the model uses `code.run` to calculate and test.
- **Preview everything** — HTML, React/JSX/TSX, JavaScript, Python, Markdown, Mermaid diagrams and SVG open in an in-app preview.
- **Skills** — reusable instruction packs (write your own, add starters, or import a `SKILL.md` from GitHub). The model loads one when a task matches.
- **MCP servers** — connect remote MCP servers (Streamable HTTP) and their tools become available in chat.
- **Pinned repos** — tell TryChat which GitHub repos are "yours".
- Markdown rendering with code blocks, dark mode, API key stored in the device's secure storage.

## Run it

```bash
npm install
npx expo start
```

Then scan the QR code with **Expo Go** on your phone (or press `a` / `i` for an emulator).
On first launch open **Settings**, paste your API key, tap **Test connection**, and choose a model.

To prefill the key/model at build time instead, copy `.env.example` to `.env` and fill it in
(`.env` is git-ignored — never commit your key).

## Accounts (sync your memory across devices)

Run the account server somewhere both phones can reach (your server works):

```bash
node server/trychat-server.mjs --port=8787 --data=./trychat-data   # --signup=false to close sign-ups
```

In the app: **Settings → Sign in** → enter the server address (default `http://169.58.133.158:8787`),
then create an account. Sign in with the same account on another device and your memory, chats and
skills appear there. Data syncs a few seconds after each change, every minute, and when the app opens.
Passwords are hashed (scrypt); for use over the internet put the server behind HTTPS
(e.g. `caddy reverse-proxy --from chat.example.com --to :8787`).

## Skills and MCP servers

**Settings → Skills:** add starter skills, write your own, or import one from GitHub
(link to a `SKILL.md`, its folder, or a repo). **Settings → MCP servers:** add a server URL
(and token if needed); its tools show up automatically. Tool calls ask first unless you turn that off per server.

## Connect GitHub and your laptop

In the app: **Settings → Connections**.

**GitHub:** create a token at github.com → Settings → Developer settings → Personal access tokens
(fine-grained: give *Contents* and *Issues* read & write on the repos you want), paste it, tap **Test**.

**Laptop:** on your computer (Node 18+), from this repo:

```bash
node bridge/trychat-bridge.mjs --root=~/Projects     # optional: --port=8765
```

It prints a **bridge address** and a **pairing code** — enter both in the app and tap **Test**.
Your phone and laptop need to be on the same Wi-Fi. The bridge only touches files inside `--root`,
rejects requests without the pairing code, and the app asks before every command or write by default.
Stop it with Ctrl+C when you're done. (To reach it away from home, use a tunnel such as Tailscale.)

Then just ask in a chat, e.g. *"Run the tests in ~/Projects/trychat and fix what fails"* or
*"Open an issue in my repo about the login bug"*.

## Build an installable app

```bash
npx eas-cli@latest build -p android --profile preview   # APK
npx eas-cli@latest build -p ios                          # needs an Apple developer account
```

The server uses plain `http://`, so the app config allows cleartext traffic
(`usesCleartextTraffic` on Android, `NSAllowsArbitraryLoads` on iOS).

## Project layout

```
src/app/            screens (Expo Router): chats list, chat/[id], settings, memory, preview
src/components/     Markdown renderer, model picker, text prompt
src/lib/api.ts      OpenAI-compatible client (models + streaming chat completions)
src/lib/prompt.ts   system prompt, memory + builder instructions, <memory> tag parsing
src/lib/store.tsx   app state, persistence, send/stop/regenerate, tool loop with approvals
src/lib/tools.ts    GitHub + laptop tools (<tool> blocks work with any OpenAI-compatible model)
src/lib/sync.ts     account sign-in + last-write-wins sync
src/lib/agents.ts   sub-agents      src/lib/mcp.ts   MCP client      src/lib/runner.ts   in-app code runner
bridge/             laptop bridge server (zero dependencies)
server/             account + sync server (zero dependencies)
```
