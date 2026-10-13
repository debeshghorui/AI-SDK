import { describe, expect, it } from "vitest";
import { SDKError } from "ai-agent-sdk";

describe("SDKError", () => {
  it("keeps a stable code and does not copy cause into the message", () => {
    const error = new SDKError("missing_config", "OPENAI_API_KEY is required", {
      provider: "openai",
      cause: "sk-live-secret",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SDKError");
    expect(error.code).toBe("missing_config");
    expect(error.provider).toBe("openai");
    expect(error.cause).toBe("sk-live-secret");
    expect(error.message).not.toContain("sk-live-secret");
  });
});
