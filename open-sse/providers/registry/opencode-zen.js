export default {
  id: "opencode-zen",
  priority: 200,
  alias: "opencode-zen",
  aliases: [
    "zen",
  ],
  uiAlias: "zen",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OZ",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Zen — curated AI gateway. Free models (big-pickle, deepseek-v4-flash-free, mimo-v2.5-free, nemotron-3-ultra-free, north-mini-code-free) require only a free account. Paid models (GPT, Claude, Gemini) require adding balance. Get your API key at opencode.ai/auth.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    headers: {},
  },
  serviceKinds: ["llm", "imageToText"],
  passthroughModels: true,
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-zen" },
};
