import {
  ProxyTracerProvider,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Span as OtelSpan,
} from "@opentelemetry/api";

export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: "chat.completions" | "chat.completions.attempt" | "agent.run" | "agent.tool";
  startTime: string;
  endTime: string;
  attributes: Record<string, string | number | boolean>;
  status: "ok" | "error";
  errorCode?: string;
};

export type SpanAttributes = Span["attributes"];

export type ActiveSpan = {
  readonly spanId: string;
  ended: boolean;
  end(result: {
    status: "ok" | "error";
    errorCode?: string;
    attributes?: SpanAttributes;
  }): void;
};

export type TraceSession = {
  list(): readonly Span[];
  clear(): void;
  start(input: {
    traceId: string;
    name: Span["name"];
    parentSpanId?: string;
    attributes?: SpanAttributes;
  }): ActiveSpan;
};

const MAX_SPANS = 200;
const TRACER_NAME = "ai-agent-sdk";

const ALLOWED_ATTRIBUTES = new Set([
  "provider",
  "model",
  "stream",
  "http.status",
  "attempt",
  "threadId",
  "user",
  "usage.prompt_tokens",
  "usage.completion_tokens",
  "tool.name",
  "tool.ok",
]);

const sessions = new WeakMap<object, TraceSession>();

export function createTraceSession(options: { enabled: boolean; content: boolean }): TraceSession {
  const buffer: Span[] = [];
  const otelSpans = new Map<string, OtelSpan>();

  return {
    list() {
      return buffer.slice();
    },
    clear() {
      buffer.length = 0;
    },
    start(input) {
      const spanId = crypto.randomUUID();
      const startedAt = new Date();
      const initial = input.attributes ?? {};
      const otel = options.enabled ? openOtel(input.name, input.parentSpanId, startedAt, otelSpans) : undefined;
      if (otel) otelSpans.set(spanId, otel);

      const active: ActiveSpan = {
        spanId,
        ended: false,
        end(result) {
          if (active.ended) return;
          active.ended = true;
          otelSpans.delete(spanId);
          if (!options.enabled) return;

          const attributes = sanitize({ ...initial, ...result.attributes }, options.content);
          const span: Span = {
            traceId: input.traceId,
            spanId,
            ...(input.parentSpanId !== undefined ? { parentSpanId: input.parentSpanId } : {}),
            name: input.name,
            startTime: startedAt.toISOString(),
            endTime: new Date().toISOString(),
            attributes: Object.freeze(attributes),
            status: result.status,
            ...(result.status === "error" && result.errorCode !== undefined
              ? { errorCode: result.errorCode }
              : {}),
          };
          buffer.push(Object.freeze(span));
          if (buffer.length > MAX_SPANS) buffer.shift();
          finishOtel(otel, attributes, result.status);
        },
      };
      return active;
    },
  };
}

export function attachTraceSession(owner: object, session: TraceSession): void {
  sessions.set(owner, session);
}

export function traceSessionFor(owner: object): TraceSession | undefined {
  return sessions.get(owner);
}

function sanitize(attributes: SpanAttributes, content: boolean): SpanAttributes {
  const out: SpanAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    if (key === "messages" || key === "output") {
      if (content && typeof value === "string") out[key] = value;
      continue;
    }
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function openOtel(
  name: Span["name"],
  parentSpanId: string | undefined,
  startedAt: Date,
  otelSpans: Map<string, OtelSpan>,
): OtelSpan | undefined {
  const tracer = realTracer();
  if (!tracer) return undefined;
  const parent = parentSpanId === undefined ? undefined : otelSpans.get(parentSpanId);
  const parentContext = parent ? trace.setSpan(ROOT_CONTEXT, parent) : undefined;
  return tracer.startSpan(name, { startTime: startedAt, root: parent === undefined }, parentContext);
}

function finishOtel(
  otel: OtelSpan | undefined,
  attributes: SpanAttributes,
  status: "ok" | "error",
): void {
  if (!otel) return;
  for (const [key, value] of Object.entries(attributes)) {
    otel.setAttribute(key, value);
  }
  otel.setStatus({ code: status === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  otel.end();
}

function realTracer() {
  const provider = trace.getTracerProvider();
  const delegate = provider instanceof ProxyTracerProvider ? provider.getDelegate() : provider;
  if (delegate.constructor.name === "NoopTracerProvider") return undefined;
  if (delegate instanceof ProxyTracerProvider) return undefined;
  return trace.getTracer(TRACER_NAME);
}
