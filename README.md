# SquadComms

A lightweight, audio-only browser voice room for gaming squads of up to 8 players. Built with React/Vite and LiveKit WebRTC, with a Node/Express server that signs short-lived join tokens. No demo participants or fake voice transport are included.

## Features
- Private room codes (6–10 characters), create or join
- LiveKit audio rooms, browser microphone permission flow
- Mute, deafen, push-to-talk (Spacebar or hold-to-talk button)
- Participant list, speaking indicator, copy room code
- Audio-only publish permission; no camera or screen-sharing publishing
- Server-side token signing, request rate limiting, input validation, max room size of 8
- Lean UI, no avatars/images/fonts loaded from third-party CDNs

## Requirements
- Node.js 20 or newer
- A LiveKit Cloud project and its URL, API key and API secret
- HTTPS in deployment (microphone access requires a secure context except localhost)

## Local development (no VS Code required)
1. Download/unzip this project.
2. Install Node.js LTS from https://nodejs.org/ if not already installed.
3. Open a terminal/Command Prompt in the `SquadComms` folder.
4. Run `npm install`.
5. Copy `.env.example` to `.env` and enter your LiveKit credentials.
6. Run `npm run dev`.
7. Open the local URL Vite prints, usually `http://localhost:5173`.

The backend runs on port 3001. Vite proxies `/api` requests to it.

## LiveKit credentials
1. Sign in at https://cloud.livekit.io/ and create a project.
2. In project settings, copy the server URL, API key and API secret.
3. Put them in `.env` as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
4. Never place the API secret in `src/`, frontend environment variables, or a committed file. Only the server process should receive it.

## Deploying
The app needs a Node-capable host because GitHub Pages cannot run the token server. Deploy the repository to a host that supports Node services (for example, Render, Railway, or another Node host). Set these environment variables in the host dashboard:
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `NODE_ENV=production`
- `ALLOWED_ORIGINS=https://your-deployed-domain.example`
- `PORT` if your host requires it

Build command: `npm install && npm run build`
Start command: `npm start`

The Express server serves the built frontend and `/api/token` from the same origin in production. Use one deployed origin where possible. If frontend and backend are split across origins, update the frontend API URL/proxy and configure exact allowed origins; do not use wildcard CORS for a private voice service.

Free hosting and LiveKit usage limits change. Check each provider's current plan, quotas, idle/sleep behavior and billing before relying on it for regular game sessions. Do not assume all usage will remain free.

## How room codes work
- The server accepts only 6–10 character codes from a restricted alphabet and uses the code to name a LiveKit room.
- A code is a bearer invite: anyone who knows it can attempt to join. Share it privately and rotate by creating a new room code.
- Rooms are capped at 8 participants and expire after 5 minutes empty.
- The endpoint is rate-limited per IP and validates names/codes. For a public launch, add proper user authentication, abuse monitoring, and a stronger room-creation/join authorization model. Rate limiting alone is not a substitute for authentication.

## Test with friends
1. Deploy with HTTPS and valid LiveKit credentials.
2. Open the website in Firefox and allow microphone access.
3. Create a room and send the code to a friend.
4. Have them open the same URL in another browser/device, enter a callsign and code, and join.
5. Check the participant count, speak and watch the speaking indicator.
6. Test mute, deafen, push-to-talk, leaving/rejoining, and microphone permission denial.
7. Test at least one friend on a different network (e.g. mobile hotspot). WebRTC behavior depends on network/NAT and LiveKit connectivity.
8. Check browser/task-manager memory use with the same number of participants; performance depends on device, browser, audio drivers and network.

## Troubleshooting
- `Voice service is not configured yet`: check server environment variables and restart.
- Microphone unavailable: use HTTPS (or localhost), allow mic access in browser site permissions, and close apps holding the microphone exclusively.
- Friends cannot hear you: verify input device, browser mic permission and LiveKit project URL.
- Room full: room cap is 8; leave the room or create a different code.
- Deployment sleeping: some free hosts sleep on inactivity; first connection may take longer.
