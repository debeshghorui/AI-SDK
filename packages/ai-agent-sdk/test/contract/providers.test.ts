import { afterEach, describe, expect, it } from "vitest";
import { SDKError } from "ai-agent-sdk";
import { azureOpenAI } from "ai-agent-sdk/azure-openai";
import { groq } from "ai-agent-sdk/groq";
import { mistral } from "ai-agent-sdk/mistral";
import { ollama } from "ai-agent-sdk/ollama";
import { openai } from "ai-agent-sdk/openai";
import type { Provider, WireChatResponse } from "../../src/provider.js";
import {
  CONTRACT_CONTENT,
  CONTRACT_DELTA,
  contractFixture,
  startContractServer,
  type ContractFixture,
  type ContractServer,
  type RecordedRequest,
} from "./server.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OLLAMA_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
] as const;

const CHAT = {
  model: "m",
  messages: [{ role: "user", content: "Hi" }],
};

const servers: ContractServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const key of ENV_KEYS) delete process.env[key];
});

function header(request: RecordedRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function messageContent(body: WireChatResponse): string | undefined {
  const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content;
}

function deltaContent(chunk: { choices?: Array<{ delta?: { content?: string } }> }): string | undefined {
  return chunk.choices?.[0]?.delta?.content;
}

async function open(mode: ContractFixture): Promise<ContractServer> {
  const server = await startContractServer(contractFixture(mode));
  servers.push(server);
  return server;
}

function expectBearer(request: RecordedRequest, token: string) {
  expect(request.method).toBe("POST");
  expect(header(request, "authorization")).toBe(`Bearer ${token}`);
  expect(header(request, "api-key")).toBeUndefined();
  expect(header(request, "content-type")).toContain("application/json");
  expect(request.url).toBe("/v1/chat/completions");
  expect(JSON.parse(request.body)).not.toHaveProperty("threadId");
}

const bearerProviders = [
  {
    name: "openai",
    token: "sk-openai",
    create: (baseURL: string) => openai({ apiKey: "sk-openai", baseURL }),
  },
  {
    name: "groq",
    token: "sk-groq",
    create: (baseURL: string) => groq({ apiKey: "sk-groq", baseURL }),
  },
  {
    name: "mistral",
    token: "sk-mistral",
    create: (baseURL: string) => mistral({ apiKey: "sk-mistral", baseURL }),
  },
  {
    name: "ollama",
    token: "sk-ollama",
    create: (baseURL: string) => ollama({ apiKey: "sk-ollama", baseURL }),
  },
] as const satisfies ReadonlyArray<{
  name: string;
  token: string;
  create: (baseURL: string) => Provider;
}>;

describe.each(bearerProviders)("$name", ({ token, create }) => {
  it("POSTs /chat/completions and returns choices[0].message.content", async () => {
    const server = await open("completion");
    const result = await create(`${server.origin}/v1`).chat(CHAT, {});

    expect(server.requests).toHaveLength(1);
    expectBearer(server.requests[0]!, token);
    expect(messageContent(result)).toBe(CONTRACT_CONTENT);
  });

  it("yields a content delta for stream: true", async () => {
    const server = await open("stream");
    const chunks = [];
    for await (const chunk of create(`${server.origin}/v1`).chatStream(CHAT, {})) {
      chunks.push(chunk);
    }

    expect(server.requests).toHaveLength(1);
    expectBearer(server.requests[0]!, token);
    expect(JSON.parse(server.requests[0]!.body).stream).toBe(true);
    expect(chunks.map(deltaContent)).toEqual([CONTRACT_DELTA]);
  });

  it("returns content after a 429", async () => {
    const server = await open("retry");
    const result = await create(`${server.origin}/v1`).chat(CHAT, {});

    expect(server.requests).toHaveLength(2);
    expectBearer(server.requests[0]!, token);
    expectBearer(server.requests[1]!, token);
    expect(messageContent(result)).toBe(CONTRACT_CONTENT);
  });

  it("maps an error body to provider_error without the key", async () => {
    const server = await open("error");
    try {
      await create(`${server.origin}/v1`).chat(CHAT, {});
      expect.fail("expected provider_error");
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      const sdk = error as SDKError;
      expect(sdk.code).toBe("provider_error");
      expect(sdk.message).toBe("nope");
      expect(sdk.message).not.toContain(token);
      expect(sdk.message).not.toContain("Bearer");
    }
    expect(server.requests).toHaveLength(1);
  });
});

describe("ollama without a key", () => {
  it("POSTs /chat/completions with no Authorization header", async () => {
    const server = await open("completion");
    const result = await ollama({ baseURL: `${server.origin}/v1` }).chat(CHAT, {});

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/v1/chat/completions");
    expect(header(request, "authorization")).toBeUndefined();
    expect(header(request, "api-key")).toBeUndefined();
    expect(JSON.parse(request.body)).not.toHaveProperty("threadId");
    expect(messageContent(result)).toBe(CONTRACT_CONTENT);
  });
});

describe("azure-openai", () => {
  const deployment = "gpt-4o-mini";
  const apiKey = "azure-key";

  function create(origin: string) {
    return azureOpenAI({ endpoint: origin, apiKey });
  }

  function expectAzure(request: RecordedRequest) {
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      `/openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`,
    );
    expect(header(request, "api-key")).toBe(apiKey);
    expect(header(request, "authorization")).toBeUndefined();
    expect(header(request, "content-type")).toContain("application/json");
    const body = JSON.parse(request.body) as { model?: string };
    expect(body).not.toHaveProperty("threadId");
    expect(body.model).toBe(deployment);
  }

  it("uses the deployment URL and api-key, and returns message content", async () => {
    const server = await open("completion");
    const result = await create(server.origin).chat(
      { ...CHAT, model: deployment },
      {},
    );

    expect(server.requests).toHaveLength(1);
    expectAzure(server.requests[0]!);
    expect(messageContent(result)).toBe(CONTRACT_CONTENT);
  });

  it("yields a content delta for stream: true", async () => {
    const server = await open("stream");
    const chunks = [];
    for await (const chunk of create(server.origin).chatStream(
      { ...CHAT, model: deployment },
      {},
    )) {
      chunks.push(chunk);
    }

    expect(server.requests).toHaveLength(1);
    expectAzure(server.requests[0]!);
    expect(JSON.parse(server.requests[0]!.body).stream).toBe(true);
    expect(chunks.map(deltaContent)).toEqual([CONTRACT_DELTA]);
  });
});
