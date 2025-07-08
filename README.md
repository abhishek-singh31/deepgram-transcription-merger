# Share Twilio

A lightweight WebSocket server that receives live Twilio Media Streams, stores interim transcripts, and merges them into a consolidated JSON file.

---

## Prerequisites

- **Node.js** v18+
- **pnpm** (alternative to npm/yarn)
- **ngrok** (to expose your local server to the public internet)
- A **Twilio** account with Media Streams enabled

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the server

```bash
pnpm start
```

The server listens on **port 3000** by default.

### 3. Expose port 3000 via ngrok

```bash
ngrok http --subdomain websocket-server 3000
```

This will give you a public WebSocket URL similar to:

```
wss://websocket-server.in.ngrok.io
```

### 4. Configure Twilio

Set the **Stream URL** of your Twilio Media Stream to the public URL provided by ngrok (e.g., `wss://websocket-server.in.ngrok.io`).

### 5. Collect Transcriptions

At the end of each call, transcription files are saved to the `transcriptions/` folder.

### 6. Merge Transcriptions

Run the merge script to combine individual transcriptions:

```bash
pnpm merge
```

This generates `combined-transcription.json` inside the `transcriptions/` directory.

---

## Folder Structure

| Path | Purpose |
|------|---------|
| `deepgram-service.js` | Handles real-time transcription via Deepgram |
| `main.js` | Entry point for the WebSocket server |
| `transcription-merger*.js` | Utilities for merging transcription files |
| `transcriptions/` | Output directory for transcription JSON files |

