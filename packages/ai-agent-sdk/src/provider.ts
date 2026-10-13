import { z } from "zod";
import { parseStrict, pickPresent, readConfig } from "./config.js";
import { SDKError } from "./errors.js";

export type ProviderId = "openai" | "groq" | "mistral" | "ollama" | "azure-openai";

export type WireChatRequest = {
  model: string;
  [key: string]: unknown;
};

export type WireChatResponse = {
  [key: string]: unknown;
};

export type WireChatChunk = {
  [key: string]: unknown;
};

export type ChatCallOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export interface Provider {
  readonly id: ProviderId;
  chat(request: WireChatRequest, options: ChatCallOptions): Promise<WireChatResponse>;
  chatStream(request: WireChatRequest, options: ChatCallOptions): AsyncIterable<WireChatChunk>;
}

export type ProviderConfig = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export type AzureConfig = ProviderConfig & {
  endpoint?: string;
  apiVersion?: string;
};

const fetchSchema = z.custom<typeof fetch>((value) => typeof value === "function");

const providerConfigSchema = z.strictObject({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  fetch: fetchSchema.optional(),
});

const azureConfigSchema = z.strictObject({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  fetch: fetchSchema.optional(),
  endpoint: z.string().optional(),
  apiVersion: z.string().optional(),
});

type ChatTarget = {
  resolveUrl: (request: WireChatRequest) => string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
};

function notWired(): never {
  throw new SDKError("unsupported_runtime", "postChat is not wired");
}

export function createProvider(id: ProviderId, target: ChatTarget): Provider {
  return {
    id,
    chat(request) {
      target.resolveUrl(request);
      return notWired();
    },
    chatStream(request) {
      target.resolveUrl(request);
      return notWired();
    },
  };
}

function chatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

function azureChatUrl(endpoint: string, model: string, apiVersion: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

function withAuth(
  auth: "bearer" | "api-key",
  apiKey: string | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (auth === "api-key") {
    delete headers.Authorization;
    delete headers.authorization;
    if (apiKey !== undefined && apiKey !== "") headers["api-key"] = apiKey;
    return headers;
  }
  if (apiKey !== undefined && apiKey !== "") headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

type BearerSpec = {
  id: "openai" | "groq" | "mistral" | "ollama";
  baseURL: string;
  baseURLEnv?: string;
  apiKeyEnv?: string;
  apiKeyRequired: boolean;
};

export function createBearerFactory(spec: BearerSpec): (config?: ProviderConfig) => Provider {
  return (config) => {
    const parsed = parseStrict(providerConfigSchema, config);
    const merged = readConfig(process.env, pickPresent(config, ["apiKey", "baseURL"]), [
      { key: "apiKey", env: spec.apiKeyEnv, required: spec.apiKeyRequired },
      { key: "baseURL", env: spec.baseURLEnv, default: spec.baseURL },
    ]);
    const baseURL = merged.baseURL ?? spec.baseURL;
    return createProvider(spec.id, {
      resolveUrl: () => chatCompletionsUrl(baseURL),
      headers: withAuth("bearer", merged.apiKey, parsed.headers),
      fetch: parsed.fetch,
    });
  };
}

export function createAzureProvider(config?: AzureConfig): Provider {
  const parsed = parseStrict(azureConfigSchema, config);
  const merged = readConfig(
    process.env,
    pickPresent(config, ["apiKey", "endpoint", "apiVersion"]),
    [
      { key: "endpoint", env: "AZURE_OPENAI_ENDPOINT", required: true },
      { key: "apiKey", env: "AZURE_OPENAI_API_KEY", required: true },
      { key: "apiVersion", default: "2024-10-21" },
    ],
  );
  const endpoint = merged.endpoint;
  const apiVersion = merged.apiVersion ?? "2024-10-21";
  if (endpoint === undefined || endpoint === "") {
    throw new SDKError("missing_config", "AZURE_OPENAI_ENDPOINT is required");
  }
  return createProvider("azure-openai", {
    resolveUrl: (request) => azureChatUrl(endpoint, request.model, apiVersion),
    headers: withAuth("api-key", merged.apiKey, parsed.headers),
    fetch: parsed.fetch,
  });
}
