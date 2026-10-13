import { createBearerFactory } from "../provider.js";

export const ollama = createBearerFactory({
  id: "ollama",
  baseURL: "http://127.0.0.1:11434/v1",
  baseURLEnv: "OLLAMA_BASE_URL",
  apiKeyRequired: false,
});
