export const SDK_ERROR_CODES = [
  "missing_config",
  "invalid_request",
  "provider_error",
  "timeout",
  "aborted",
  "invalid_output",
  "tool_failed",
  "max_steps",
  "unsupported_runtime",
  "memory_error",
] as const;

export type SDKErrorCode = (typeof SDK_ERROR_CODES)[number];

export type SDKErrorExtra = {
  provider?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  cause?: unknown;
};

export class SDKError extends Error {
  readonly code: SDKErrorCode;
  readonly provider?: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly traceId?: string;

  constructor(code: SDKErrorCode, message: string, extra?: SDKErrorExtra) {
    super(message, extra?.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = "SDKError";
    this.code = code;
    if (extra?.provider !== undefined) this.provider = extra.provider;
    if (extra?.status !== undefined) this.status = extra.status;
    if (extra?.requestId !== undefined) this.requestId = extra.requestId;
    if (extra?.traceId !== undefined) this.traceId = extra.traceId;
  }
}
