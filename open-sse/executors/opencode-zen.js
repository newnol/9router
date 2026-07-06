import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

const ZEN_BASE = "https://opencode.ai/zen/v1";

// Models that use /zen/v1/messages (Anthropic/Claude format + x-api-key auth)
const MESSAGES_FORMAT_MODELS = new Set([
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-opus-4-1",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "qwen3.7-max",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "grok-build-0.1",
]);

// Models that use /zen/v1/responses (OpenAI Responses API format)
const RESPONSES_FORMAT_MODELS = new Set([
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex-spark",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-nano",
]);

// Models that use /zen/v1/models/{model} (Gemini Google AI format)
const GEMINI_FORMAT_MODELS = new Set([
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-3-flash",
]);

export class OpenCodeZenExecutor extends BaseExecutor {
  constructor() {
    super("opencode-zen", PROVIDERS["opencode-zen"]);
  }

  /** Determine the target endpoint for a given model */
  getEndpoint(model) {
    if (GEMINI_FORMAT_MODELS.has(model)) {
      return `${ZEN_BASE}/models/${model}`;
    }
    if (RESPONSES_FORMAT_MODELS.has(model)) {
      return `${ZEN_BASE}/responses`;
    }
    if (MESSAGES_FORMAT_MODELS.has(model)) {
      return `${ZEN_BASE}/messages`;
    }
    // Everything else: OpenAI-compatible chat completions
    return `${ZEN_BASE}/chat/completions`;
  }

  /** Determine the target format for translator routing */
  getTargetFormat(model) {
    if (GEMINI_FORMAT_MODELS.has(model)) return "gemini";
    if (RESPONSES_FORMAT_MODELS.has(model)) return "openai";
    if (MESSAGES_FORMAT_MODELS.has(model)) return "claude";
    return "openai";
  }

  buildUrl(model) {
    this._lastModel = model;
    return this.getEndpoint(model);
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (this._lastModel && MESSAGES_FORMAT_MODELS.has(this._lastModel)) {
      // Claude-format models use x-api-key
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      // OpenAI-format models use Bearer token
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    // OpenCode-specific client header
    headers["x-opencode-client"] = "9router";

    return headers;
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
