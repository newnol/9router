export default {
  id: "digitalocean",
  priority: 80,
  alias: "digitalocean",
  uiAlias: "do",
  display: {
    name: "DigitalOcean",
    icon: "cloud",
    color: "#0060FF",
    textIcon: "DO",
    website: "https://docs.digitalocean.com/products/ai-platform/",
    notice: {
      apiKeyUrl: "https://cloud.digitalocean.com/account/api/tokens",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
  },
  serviceKinds: ["llm"],
  passthroughModels: true,
};
