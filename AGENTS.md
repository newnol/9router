# 9Router Project Guide

## Overview
**9Router** — AI Router & Token Saver. Local proxy/gateway cung cấp endpoint OpenAI-compatible duy nhất, routing requests tới 40+ AI providers và 100+ models. Hỗ trợ auto-fallback (subscription → cheap → free), format translation giữa các provider, RTK token compression, OAuth, multi-account round-robin, usage tracking, và cloud sync.

- Runtime: **Node.js 20+** | Framework: **Next.js 16** (App Router, webpack) | UI: **React 19 + Tailwind CSS 4**
- Database: **SQLite** (better-sqlite3 → sql.js → node:sqlite → bun:sqlite)
- State: **Zustand 5** | Streaming: **SSE** | Auth: **JWT + OAuth 2.0 (PKCE) + API Keys**
- CLI trên npm: `9router` | Web: [9router.com](https://9router.com)

## Project Structure

```
/
├── src/                    # Next.js app (private, 9router-app)
│   ├── app/                # App Router pages + API routes
│   │   └── api/            # Tất cả API endpoints
│   │       ├── v1/         # OpenAI-compatible API (chat, models, audio, images, embeddings, search, web)
│   │       ├── providers/  # CRUD providers
│   │       ├── oauth/      # Device-code OAuth flows
│   │       ├── combos/     # Model combo CRUD
│   │       ├── keys/       # API key lifecycle
│   │       ├── usage/      # Usage stats, charts, logs
│   │       └── settings/   # App settings
│   ├── sse/                # SSE + routing core (Next.js integration layer)
│   │   ├── handlers/       # chat, search, fetch, embeddings, image, stt, tts
│   │   └── services/       # auth (credential selection), model (resolution + combo)
│   ├── mitm/               # Man-in-the-middle HTTPS proxy (port 443)
│   │   ├── server.js       # TLS MITM server
│   │   ├── manager.js      # Lifecycle (start/stop/DNS)
│   │   ├── cert/           # Root CA + cert generation/install
│   │   └── handlers/       # antigravity, copilot, kiro, cursor
│   ├── lib/                # Shared libraries
│   │   ├── db/             # SQLite layer (adapter pattern, repos, migrations)
│   │   ├── auth/           # JWT session, login limiter, OIDC
│   │   └── network/        # Proxy config, outbound proxy
│   ├── shared/             # Isomorphic code (components, constants, hooks, services, utils)
│   ├── store/              # Zustand stores
│   └── i18n/               # Runtime internationalization
│
├── open-sse/               # SSE core module (reusable, shared giữa src & CLI)
│   ├── config/             # Provider definitions, models, constants
│   ├── handlers/           # chatCore, responses, embeddings, image, stt, tts, search, fetch
│   ├── services/           # provider, model, accountFallback, combo, tokenRefresh, usage...
│   ├── executors/          # 21 provider-specific adapters (đều extend base executor)
│   ├── translator/         # Format translation engine (source → OpenAI → target)
│   │   ├── request/        # 11 request translators
│   │   └── response/       # 9 response translators
│   ├── rtk/                # RTK Token Saver port (Rust → JS) — compression filters
│   └── utils/              # stream, error, proxyFetch, clientDetector, toolDeduper...
│
├── cli/                    # npm-published package (name: "9router")
│   ├── cli.js              # Entry point (khởi động Next.js server)
│   └── hooks/              # postinstall (SQLite, tray runtime)
│
├── tests/                  # Vitest test suite
│   ├── translator/         # Translator unit tests
│   └── unit/               # Unit tests
│
├── skills/                 # OpenAI/MCP skill definitions
├── public/                 # Static assets
└── data/                   # Runtime data (DB, certs, machine-id)
```

## Request Lifecycle

```
Client → POST /v1/chat/completions
  → next.config.mjs rewrite (/v1/* → /api/v1/*)
    → src/app/api/v1/chat/completions/route.js
      → src/sse/handlers/chat.js
        1. Parse request, extract model
        2. Check combo (multi-model fallback sequence)
        3. Resolve model → provider (src/sse/services/model.js)
        4. Select credentials (src/sse/services/auth.js): fill-first, round-robin, smart, least-concurrency
        5. Call open-sse/handlers/chatCore.js:
          a. Detect source format (OpenAI, Claude, Gemini, ...)
          b. Translate request → target format
          c. Apply RTK compression + Caveman mode
          d. Execute via provider-specific executor
          e. Stream/non-stream response
          f. Translate response back → client format
          g. Track usage, persist request details
```

## Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Auth Guard | `src/dashboardGuard.js` | Next.js middleware: JWT/API key validation, local-only enforcement |
| Chat Handler | `src/sse/handlers/chat.js` | Entry: combo detection, credential loop, account fallback |
| Chat Core | `open-sse/handlers/chatCore.js` | Orchestration: format detection, translation, RTK, executor dispatch, 401 auto-refresh |
| Format Translator | `open-sse/translator/` | Registry: source↔target conversion (OpenAI, Claude, Gemini, Kiro, Cursor, ...) |
| Provider Executors | `open-sse/executors/*.js` | 21 provider adapters: URL, headers, auth, request/response |
| Account Fallback | `open-sse/services/accountFallback.js` | Error heuristics, cooldown, model locking, exponential backoff |
| Combo Management | `open-sse/services/combo.js` | Model fallback sequences, round-robin rotation |
| Token Refresh | `open-sse/services/tokenRefresh.js` | OAuth token refresh cho tất cả providers |
| RTK | `open-sse/rtk/` | JS port của RTK: auto-detect + lossless compress tool output (saves 20-40% input tokens) |
| Caveman | `open-sse/rtk/caveman.js` | Terse output prompt injection (saves up to 65% output tokens) |
| MITM Proxy | `src/mitm/` | HTTPS MITM trên port 443: tự sinh CA, /etc/hosts DNS, intercept IDE tools |
| DB Layer | `src/lib/db/` | SQLite adapter pattern + repositories per entity + migrations |

## Database

- SQLite với adapter auto-select: `better-sqlite3` > `sql.js` > `node:sqlite` > `bun:sqlite`
- Repository pattern trong `src/lib/db/repos/`
- Migrations trong `src/lib/db/migrations/`
- Tables: providers, connections, aliases, combos, keys, settings, pricing, proxy_pools, nodes

## Scripts (root package.json)

| Script | Command |
|--------|---------|
| `npm run dev` | `next dev --webpack --port 20128` |
| `npm run build` | `next build --webpack` |
| `npm run start` | `next start` |
| `npm run dev:bun` | `bun --bun next dev --webpack --port 20128` |

Tests (trong `tests/`): `vitest run --reporter=verbose`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | Auto-generated | JWT signing |
| `INITIAL_PASSWORD` | `123456` | Initial login password |
| `DATA_DIR` | `~/.9router` | Data directory |
| `PORT` | 20128 | Service port |
| `ENABLE_REQUEST_LOGS` | `false` | Enable request/response logging |
| `REQUIRE_API_KEY` | `false` | Enforce API key on /v1/* |
| `HTTP_PROXY` / `HTTPS_PROXY` | empty | Outbound proxy |

## Key Architectural Patterns

1. **Dual-module**: `src/` (Next.js) + `open-sse/` (reusable core) — open-sse có thể chạy độc lập
2. **Format translation**: 2-step pipeline source→OpenAI→target, 11 request + 9 response translators
3. **Multi-layer fallback**: account-level → model-level (combo) → provider-tier (subscription→cheap→free)
4. **Executor pattern**: Mỗi provider có executor riêng extend base, đăng ký trong registry
5. **MITM subsystem**: Child process riêng với sudo, tự quản lý CA certs + DNS
6. **RTK compression**: JS port của Rust RTK, auto-detect tool output types (git-diff, grep, ls, tree, ...)

## Coding Conventions

- **ES Modules** throughout (`import`/`export`, không dùng `require`)
- **JS** (không TypeScript) — dùng JSDoc comments cho type hints
- Path alias: `@/*` → `src/*`, `open-sse` → `open-sse/*`
- Component conventions theo Next.js App Router (file-based routing, server components mặc định)
- Format translation: luôn qua OpenAI intermediate format
- Streaming: SSE-based với custom stream transforms
