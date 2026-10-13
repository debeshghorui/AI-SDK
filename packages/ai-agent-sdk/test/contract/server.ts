import { createServer, type ServerResponse } from "node:http";

export const CONTRACT_CONTENT = "hello from mock";
export const CONTRACT_DELTA = "Hel";

export function completionBody(content = CONTRACT_CONTENT) {
  return {
    id: "chatcmpl-contract",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

export function serveOpenAISubset(response: ServerResponse, content = CONTRACT_CONTENT) {
  writeJson(response, 200, completionBody(content));
}

export function serveSseStream(response: ServerResponse, delta = CONTRACT_DELTA) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: delta } }] })}\n\ndata: [DONE]\n\n`,
  );
}

export function serveRetryThenSuccess(
  response: ServerResponse,
  index: number,
  content = CONTRACT_CONTENT,
) {
  if (index === 0) {
    writeJson(response, 429, { error: { message: "slow down" } });
    return;
  }
  serveOpenAISubset(response, content);
}

export function serveErrorBody(response: ServerResponse, message = "nope", status = 400) {
  writeJson(response, status, { error: { message } });
}

export type ContractFixture = "completion" | "stream" | "retry" | "error";

export function contractFixture(mode: ContractFixture) {
  return (_request: RecordedRequest, response: ServerResponse, index: number) => {
    if (mode === "completion") serveOpenAISubset(response);
    else if (mode === "stream") serveSseStream(response);
    else if (mode === "retry") serveRetryThenSuccess(response, index);
    else serveErrorBody(response);
  };
}

export type RecordedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type ContractServer = {
  origin: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

export async function startContractServer(
  handler: (
    request: RecordedRequest,
    response: ServerResponse,
    index: number,
  ) => void | Promise<void>,
): Promise<ContractServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const recorded: RecordedRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    const index = requests.length;
    requests.push(recorded);
    try {
      await handler(recorded, res, index);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
      }
      res.end(error instanceof Error ? error.message : "handler failed");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("contract server did not bind a port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
