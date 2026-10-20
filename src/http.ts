import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http-error.js";

export function sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

export function handleHttpError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(response, 500, {
    error: "Internal server error",
  });
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    let buffer: Buffer;
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else {
      buffer = Buffer.from(chunk);
    }
    size += buffer.length;
    if (size > 16_384) {
      request.resume();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
