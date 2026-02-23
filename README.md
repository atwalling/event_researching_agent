# Event Researching Agent

Codespaces-friendly app that orchestrates sport event deep research and outputs JSON + CSV grouped by Joinable and Watchable.

## Features
- Multi-agent orchestration flow: prompt builder -> deep/web research model -> validation agent (gpt-5-mini).
- Timeframe and sport selectors (top 5 sports dropdown).
- Agent count splitter to divide timeframe into chunks per researcher.
- Streaming/background flags sent for provider calls where supported.
- Existing CSV memory read per sport (`data/<sport>.csv`) and dedupe guard (`DO NOT REPEAT`).
- UI cards with price, source URL, and event details.
- CSV output with headers: `Event Title,Date,Time,City,Venue/Location,Cost,Direct URL`.

## Codespaces Quick Start
1. `npm start`
2. Open forwarded port `3000`.

## Environment Variables
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

Use `.env.example` as a template:
1. `cp .env.example .env`
2. Fill in at least one API key.

If no API keys are present, the app still runs and returns empty validated output.

## Troubleshooting
- `.env` is loaded directly by the server at startup, so keys are picked up even if `dotenv` is unavailable in the runtime.
- The server and research flow now emit structured JSON logs to stdout/stderr.
- Validation errors are returned from `/api/research` with actionable messages.
- Per-agent provider/parsing failures are exposed in `meta.errors` in API responses.
- Per-agent flow telemetry is returned in `meta.flow` so validation outcomes can be showcased in the UI.
