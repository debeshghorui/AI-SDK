import { createBearerFactory } from "../provider.js";

export const groq = createBearerFactory({
  id: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  apiKeyEnv: "GROQ_API_KEY",
  apiKeyRequired: true,
});
