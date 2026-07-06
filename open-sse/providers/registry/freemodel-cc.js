export default {
  id: "freemodel-cc",
  priority: 70,
  hasFree: true,
  alias: "freemodel-cc",
  uiAlias: "FreeModel CC",
  display: {
    name: "FreeModel CC",
    icon: "currency_exchange",
    color: "#16A34A",
    textIcon: "FC",
    website: "https://freemodel.dev",
    notice: {
      apiKeyUrl: "https://freemodel.dev/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://cc.freemodel.dev/v1/messages",
    format: "claude",
  },
  serviceKinds: ["llm"],
  passthroughModels: true,
};
