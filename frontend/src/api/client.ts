// API 客户端：封装所有后端 HTTP 调用

const API = ""; // 同源（dev 时 Vite proxy，prod 时 Deno.serve）

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
  return r.json();
}

export async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
  return r.json();
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const r = await fetch(API + path, { method: "DELETE" });
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
  return r.json();
}

export async function apiPut<T = any>(path: string, body?: any): Promise<T> {
  const r = await fetch(API + path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
  return r.json();
}

// SSE 事件流
export function createEventSource(sessionId: string): EventSource {
  return new EventSource(API + "/api/events/" + sessionId + "/stream");
}
