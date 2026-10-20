import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http-error.js";

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export function handleHttpError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(res, 500, { error: "Internal server error" });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    let buffer: Buffer;
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else {
      buffer = Buffer.from(chunk);
    }
    size += buffer.length;
    if (size > 16384) {
      req.resume();
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
