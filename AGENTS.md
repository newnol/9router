# 9Router — Agent Guide

## Project Overview

9Router is a local AI routing gateway and dashboard built on Next.js. Provides a single OpenAI-compatible endpoint (`/v1/*`) that routes to 40+ AI providers with format translation, multi-account fallback, token refresh, and usage tracking.

Core features: format translation (OpenAI ↔ Claude ↔ Gemini ↔ ...), account credential rotation & circuit breaker, combo model fallback, RTK token compression, MITM proxy for Antigravity/Copilot/Cursor/Kiro.

## Quick Start

```bash
npm run dev     # Next.js dev server on port 20128
npm run build   # Production build
npm test        # (via vitest in tests/ directory)
```

Testing: `node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/`

## Codebase Map

| Path | Purpose |
|------|---------|
| `src/app/api/` | Next.js API routes — dashboard CRUD + compatibility endpoints |
| `src/sse/handlers/` | Request handlers: chat, embeddings, image, TTS, STT, search, fetch |
| `src/sse/services/` | Auth, model resolution, token refresh |
| `open-sse/handlers/` | Core orchestration: chatCore, embeddingsCore |
| `open-sse/executors/` | Provider-specific request executors (21 providers) |
| `open-sse/translator/` | Format translation (OpenAI ↔ Claude ↔ Gemini ↔ ...) |
| `open-sse/services/` | Provider config, account fallback, model parsing, combo logic, scoring |
| `open-sse/rtk/` | RTK token compression port (JS) |
| `open-sse/utils/` | Error helpers, SSE streams, usage tracking, proxy fetch |
| `src/lib/` | Local DB (SQLite-like JSON), usage DB |
| `src/shared/` | Constants, provider definitions, UI components |
| `src/mitm/` | HTTPS MITM proxy server |

## Architecture (Request Flow)

```
Client → Next.js Middleware (dashboardGuard) → Rewrite (next.config.mjs)
  → API Route → SSE Handler → Model Resolution → Credential Selection
  → Format Translation → Executor → Upstream Provider → Response
```

### 1) API Routes (`src/app/api/`)
- `/v1/chat/completions` → `handleChat`
- `/v1/messages` → `handleChat` (Claude format)
- `/v1/embeddings` → `handleEmbeddings`
- `/v1/images/generations` → `handleImageGeneration`
- `/v1/audio/speech` → `handleTts`
- `/v1/audio/transcriptions` → `handleStt`
- `/v1/search` → `handleSearch`
- `/v1/web/fetch` → `handleFetch`
- Rewrites in `next.config.mjs`: `/v1/*` → `/api/v1/*`

### 2) SSE Handlers (`src/sse/handlers/`)
Each handler follows the same pattern:
- Parse JSON body
- Validate API key
- Resolve model string to `{ provider, model }`
- Check for combo (model group with fallback)
- **Credential selection loop**: `while(true)` with `getProviderCredentials`, fallback on error, `markAccountUnavailable` on failure
- Dispatch to `handleXxxCore` from `open-sse`

### 3) Credential Selection (`src/sse/services/auth.js`)
- `getProviderCredentials()`: Filters by strategy (fill-first, round-robin, smart, least-concurrency, weighted-round-robin)
- Filters out model-locked connections + circuit-breaker connections
- Returns `{ allRateLimited: true, retryAfter }` when all locked
- `markAccountUnavailable()`: Sets per-model lock with exponential backoff, trips circuit breaker at 5 consecutive failures
- `clearAccountError()`: Resets error state on success
- **Credential Queue**: When all accounts are rate-limited, `waitForAvailableCredentials()` waits up to 30s cumulative for a lock to expire, then retries — avoids immediate "no active credential" errors (see `accountFallback.js`)

### 4) Format Translation (`open-sse/translator/`)
- Registry-based: source → OPENAI → target (bidirectional)
- Supports: OpenAI chat/responses, Claude, Gemini, Antigravity, Kiro, Cursor, Codex
- `detectFormat(body)` reads payload shape to determine source format

### 5) Executors (`open-sse/executors/`)
- `base.js`: shared `buildUrl()`, `buildHeaders()`, `execute()`
- `default.js`: generic OpenAI/Anthropic-compatible providers
- Specialized: antigravity, codex, cursor, gemini-cli, github, kiro, qoder, vertex

## Key Patterns

### Import conventions
```js
// ESM only, full .js extensions, path aliases:
import { x } from "open-sse/services/foo.js";     // → ./open-sse/services/foo.js
import { x } from "@/lib/localDb";                  // → ./src/lib/localDb
import { x } from "../relative/path.js";            // relative
```

### Error responses
```js
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
errorResponse(400, "Invalid JSON body");                 // OpenAI-compatible JSON
unavailableResponse(503, msg, retryAfter, humanReadable); // + Retry-After header
```
Error body shape: `{ error: { message, type, code } }` with types from `open-sse/config/errorConfig.js`.

### Logging
```js
import * as log from "../utils/logger.js";
log.warn("TAG", "message");   // runtime warnings
log.info("TAG", "message");   // routing info
log.debug("TAG", "message");  // verbose debug
log.request("VERB", "path");  // request logging
```

### Handler fallback loop
```js
const excludeConnectionIds = new Set();
let lastError = null, lastStatus = null;
let totalCredentialWaitMs = 0;

while (true) {
  const creds = await getProviderCredentials(provider, excludeConnectionIds, model);
  if (!creds || creds.allRateLimited) {
    if (creds?.allRateLimited) {
      const queued = await waitForAvailableCredentials(creds, provider, model, log, totalCredentialWaitMs);
      if (queued) { totalCredentialWaitMs = queued.totalWaitedMs; continue; }
      return unavailableResponse(status, message, creds.retryAfter, creds.retryAfterHuman);
    }
    return errorResponse(status, message);
  }
  const result = await handleXxxCore({ ... });
  if (result.success) { clearAccountError(...); return result.response; }
  const { shouldFallback } = await markAccountUnavailable(creds.connectionId, result.status, result.error, provider, model);
  if (shouldFallback) { excludeConnectionIds.add(creds.connectionId); continue; }
  return result.response;
}
```

## Testing
- Framework: Vitest v4, config at `tests/vitest.config.js`
- Aliases: `open-sse/` → `../open-sse/`, `@/` → `../src/`
- Mocking: `vi.hoisted()` for shared mocks, `vi.mock()` for module mocking
- Dynamic imports: `const { fn } = await import(MODULE_PATH);` with `vi.resetModules()` in beforeEach
- Run: `node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/<file>.test.js`

## Key Files Reference

| File | What it does |
|------|-------------|
| `src/sse/handlers/chat.js` | Main chat handler — auth, combo, account fallback loop |
| `src/sse/services/auth.js` | Credential selection, markAccountUnavailable, clearAccountError, circuit breaker |
| `open-sse/services/accountFallback.js` | Error classification rules, backoff, model lock helpers, waitForAvailableCredentials |
| `open-sse/config/errorConfig.js` | ERROR_RULES, BACKOFF_CONFIG, cooldown constants |
| `open-sse/handlers/chatCore.js` | Format detection, translation pipeline, executor dispatch, token savings |
| `open-sse/executors/base.js` | Base executor with buildUrl, buildHeaders, execute |
| `open-sse/executors/default.js` | Default executor for OpenAI/Anthropic compatible providers |
| `open-sse/translator/index.js` | Translator registry, request/response orchestration |
| `open-sse/services/combo.js` | Combo model fallback/round-robin |
| `open-sse/services/connectionScoring.js` | Smart routing scoring algorithm |
| `open-sse/services/inFlightTracker.js` | In-flight request counting, RPM tracking |
| `open-sse/services/provider.js` | Provider config, URL building, format detection |
| `open-sse/services/model.js` | Model string parsing, alias resolution |
| `src/sse/services/model.js` | getModelInfo, getComboModels |
| `open-sse/utils/error.js` | errorResponse, unavailableResponse, parseUpstreamError |
| `src/lib/localDb.js` | JSON file-based persistent storage |
| `src/proxy.js` | Next.js middleware — multi-layered access control |
| `docs/ARCHITECTURE.md` | Full architecture documentation |

## Credential Queue (added 2026-06-10)

When all accounts for a provider are rate-limited (`allRateLimited`), `waitForAvailableCredentials()` in `accountFallback.js`:
- Calculates time until earliest model lock expires
- Waits (up to 30s cumulative budget) then retries credential selection
- Returns null if wait exceeds budget → handler falls through to error response
- Skipped entirely if `retryAfter > remainingBudget` (no pointless waiting)
- Affects all 7 SSE handlers (chat, embeddings, image, search, fetch, stt, tts)
