import { createBearerFactory } from "../provider.js";

export const openai = createBearerFactory({
  id: "openai",
  baseURL: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  apiKeyRequired: true,
});
