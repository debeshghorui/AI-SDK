import { afterEach, describe, expect, it } from "vitest";
import { SDKError } from "ai-agent-sdk";
import { azureOpenAI } from "ai-agent-sdk/azure-openai";
import { groq } from "ai-agent-sdk/groq";
import { mistral } from "ai-agent-sdk/mistral";
import { ollama } from "ai-agent-sdk/ollama";
import { openai } from "ai-agent-sdk/openai";

const SAMPLE_KEY = "sk-sample-should-not-leak";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OLLAMA_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("provider factories", () => {
  it("throws missing_config when OPENAI_API_KEY is unset and does not echo a sample key", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => openai()).toThrow(SDKError);
    try {
      openai();
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("missing_config");
      expect((error as SDKError).message).toContain("OPENAI_API_KEY");
      expect((error as SDKError).message).not.toContain(SAMPLE_KEY);
    }
  });

  it("treats an empty apiKey as a value even when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = SAMPLE_KEY;
    expect(() => openai({ apiKey: "" })).toThrow(SDKError);
    try {
      openai({ apiKey: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("missing_config");
      expect((error as SDKError).message).not.toContain(SAMPLE_KEY);
    }
  });

  it("rejects an unknown argument key", () => {
    expect(() =>
      openai({ apiKey: "sk-explicit", extra: true } as { apiKey: string }),
    ).toThrow(SDKError);
    try {
      openai({ apiKey: "sk-explicit", extra: true } as { apiKey: string });
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_request");
      expect((error as SDKError).message).not.toContain("sk-explicit");
    }
  });

  it("constructs groq and mistral when a key is passed", () => {
    expect(groq({ apiKey: "g" }).id).toBe("groq");
    expect(mistral({ apiKey: "m" }).id).toBe("mistral");
  });

  it("constructs ollama when no key is set", () => {
    delete process.env.OLLAMA_BASE_URL;
    expect(ollama().id).toBe("ollama");
  });

  it("throws missing_config when Azure endpoint or key is absent", () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    expect(() => azureOpenAI()).toThrow(SDKError);
    try {
      azureOpenAI();
    } catch (error) {
      expect((error as SDKError).code).toBe("missing_config");
      expect((error as SDKError).message).not.toContain(SAMPLE_KEY);
    }

    expect(() => azureOpenAI({ endpoint: "https://example.openai.azure.com" })).toThrow(
      SDKError,
    );
    try {
      azureOpenAI({ endpoint: "https://example.openai.azure.com" });
    } catch (error) {
      expect((error as SDKError).code).toBe("missing_config");
    }

    expect(() => azureOpenAI({ apiKey: "azure-secret-key" })).toThrow(SDKError);
    try {
      azureOpenAI({ apiKey: "azure-secret-key" });
    } catch (error) {
      expect((error as SDKError).code).toBe("missing_config");
      expect((error as SDKError).message).not.toContain("azure-secret-key");
    }
  });

  it("returns an azure-openai provider when endpoint and key are set", async () => {
    const provider = azureOpenAI({
      endpoint: "https://example.openai.azure.com",
      apiKey: "k",
      fetch: async () =>
        new Response(JSON.stringify({ id: "chatcmpl-test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(provider.id).toBe("azure-openai");
    await expect(provider.chat({ model: "gpt-4o-mini" }, {})).resolves.toMatchObject({
      id: "chatcmpl-test",
    });
  });
});
