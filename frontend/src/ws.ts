type Msg = { type: string; payload: any };
const WS_URL = `ws://${location.hostname}:8080`;
let ws = new WebSocket(WS_URL);

const listeners = new Set<(m: Msg) => void>();

ws.onmessage = (e) => {
  const msg: Msg = JSON.parse(e.data);
  listeners.forEach((cb) => cb(msg));
};

export function onMessage(cb: (m: Msg) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function send(type: string, payload?: any) {
  const data = JSON.stringify({ type, payload });
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
  else ws.addEventListener("open", () => ws.send(data), { once: true });
}
