export default {
  id: "bluesminds",
  priority: 80,
  alias: "bluesminds",
  display: {
    name: "BluesMinds",
    icon: "psychology",
    color: "#4A90D9",
    textIcon: "BM",
    website: "https://bluesminds.com",
    notice: {
      apiKeyUrl: "https://bluesminds.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.bluesminds.com/v1/chat/completions",
    validateUrl: "https://api.bluesminds.com/v1/models",
  },
  serviceKinds: ["llm"],
};
