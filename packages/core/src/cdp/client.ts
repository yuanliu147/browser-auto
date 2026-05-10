import { WebSocket } from "ws";

export interface CDPCommand {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: string };
}

export interface CDPEvent {
  method: string;
  params?: Record<string, unknown>;
}

type EventHandler = (params: Record<string, unknown>) => void;

export class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private eventHandlers = new Map<string, EventHandler[]>();
  private closed = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as CDPResponse | CDPEvent;
        if ("id" in msg && msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(
                new Error(`CDP ${msg.error.message} (code: ${msg.error.code})`)
              );
            } else {
              pending.resolve(msg.result ?? {});
            }
          }
        } else if ("method" in msg && msg.method) {
          const handlers = this.eventHandlers.get(msg.method);
          if (handlers) {
            for (const h of handlers) {
              try {
                h(msg.params ?? {});
              } catch {
                /* ignore handler errors */
              }
            }
          }
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    ws.on("close", () => {
      this.closed = true;
      for (const [, p] of this.pending) {
        p.reject(new Error("CDP WebSocket closed"));
      }
      this.pending.clear();
    });

    ws.on("error", (err) => {
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("CDP client is closed"));
    }
    const id = this.nextId++;
    const cmd: CDPCommand = { id, method, params };
    if (sessionId) {
      cmd.sessionId = sessionId;
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject,
      });
      this.ws.send(JSON.stringify(cmd));
    });
  }

  on(event: string, handler: EventHandler): () => void {
    const list = this.eventHandlers.get(event) ?? [];
    list.push(handler);
    this.eventHandlers.set(event, list);
    return () => {
      const updated = this.eventHandlers.get(event) ?? [];
      const idx = updated.indexOf(handler);
      if (idx >= 0) updated.splice(idx, 1);
    };
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }

  isClosed(): boolean {
    return this.closed;
  }
}
