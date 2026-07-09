import { AsyncLocalStorage } from "node:async_hooks";

export interface SessionContext {
  sessionId: string;
}

export const sessionContext = new AsyncLocalStorage<SessionContext>();
