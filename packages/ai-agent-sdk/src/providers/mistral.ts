import { createBearerFactory } from "../provider.js";

export const mistral = createBearerFactory({
  id: "mistral",
  baseURL: "https://api.mistral.ai/v1",
  apiKeyEnv: "MISTRAL_API_KEY",
  apiKeyRequired: true,
});
