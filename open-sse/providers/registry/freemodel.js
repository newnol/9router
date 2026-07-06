export default {
  id: "freemodel",
  priority: 70,
  hasFree: true,
  alias: "freemodel",
  display: {
    name: "FreeModel",
    icon: "currency_exchange",
    color: "#22C55E",
    textIcon: "FM",
    website: "https://freemodel.dev",
    notice: {
      apiKeyUrl: "https://freemodel.dev/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    validateUrl: "https://api.freemodel.dev/v1/models",
  },
  serviceKinds: ["llm"],
  passthroughModels: true,
};
