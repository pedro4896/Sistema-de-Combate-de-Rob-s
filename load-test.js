import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 50 },
    { duration: "20s", target: 0 },
  ],
thresholds: {
  "http_req_duration{kind:rest}": ["p(95)<800", "p(99)<1200"],
  "http_req_failed{kind:rest}": ["rate<0.01"],
  "ws_connecting{kind:ws}": ["p(95)<1000"],
  "checks{kind:ws}": ["rate>0.99"],
},

};

const BASE_URL = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const WS_URL = (__ENV.WS_URL || "ws://localhost:8080").replace(/\/$/, "");

const LOGIN_PATH = __ENV.LOGIN_PATH || "/auth/login";
const USER = __ENV.USER || "admin";
const PASS = __ENV.PASS || "123456";

const DEBUG = (__ENV.DEBUG || "0") === "1";

// se você já souber o id, passe: -e TOURNAMENT_ID="..."
const TOURNAMENT_ID_ENV = __ENV.TOURNAMENT_ID || "";

const rest_fail = new Counter("rest_fail");

/**
 * Tenta extrair um ID de torneio de várias rotas comuns.
 * Se nada funcionar, você deve passar TOURNAMENT_ID via env.
 */
function discoverTournamentId(baseUrl, token) {
  const candidates = [
    "/tournaments",
    "/tournament",
    "/matches",
    "/robots",
    "/db/tournaments",
  ];

  for (const p of candidates) {
    const r = http.get(`${baseUrl}${p}`, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { kind: "rest", name: `DISCOVER ${p}` },
    });

    if (r.status >= 200 && r.status < 300) {
      let data;
      try {
        data = r.json();
      } catch {
        continue;
      }

      // tenta padrões comuns: array direto, {tournaments:[]}, {data:[]}
      const arr =
        (Array.isArray(data) && data) ||
        (Array.isArray(data.tournaments) && data.tournaments) ||
        (Array.isArray(data.data) && data.data) ||
        (Array.isArray(data.items) && data.items) ||
        null;

      if (arr && arr.length) {
        const first = arr[0];
        const id = first.id || first.tournamentId || first._id;
        if (id) return String(id);
      }
    }
  }

  return "";
}

export function setup() {
  // 1) Login
  const loginRes = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({ username: USER, password: PASS }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { kind: "rest", name: `POST ${LOGIN_PATH}` },
    }
  );

  const okLogin = check(loginRes, { "login status 200": (r) => r.status === 200 });
  if (!okLogin) throw new Error(`Login falhou: ${loginRes.status} ${loginRes.body}`);

  const j = loginRes.json() || {};
  const token =
    j.token ||
    j.access_token ||
    j.accessToken ||
    j.jwt ||
    (j.data && (j.data.token || j.data.access_token || j.data.accessToken || j.data.jwt));

  if (!token) throw new Error(`Login não retornou token. body=${loginRes.body}`);

  if (DEBUG) console.log(`LOGIN OK -> tokenLen=${String(token).length}`);

  // 2) Tournament ID
  let tournamentId = TOURNAMENT_ID_ENV;

  if (!tournamentId) {
    tournamentId = discoverTournamentId(BASE_URL, token);
    if (DEBUG) console.log(`DISCOVER tournamentId -> ${tournamentId || "(vazio)"}`);
  }

  if (!tournamentId) {
    throw new Error(
      "Não consegui descobrir tournamentId automaticamente. " +
        'Passe manualmente: k6 run -e TOURNAMENT_ID="SEU_ID" load-test.js'
    );
  }

  return { token, tournamentId };
}

export default function (data) {
  const token = data.token;
  const tournamentId = data.tournamentId;

  // REST correto: /tournaments/:id/data
  const restPath = `/tournaments/${tournamentId}/data`;
  const restRes = http.get(`${BASE_URL}${restPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { kind: "rest", name: `GET ${restPath}` },
  });

  const restOk = check(
    restRes,
    {
      "REST status 2xx": (r) => r.status >= 200 && r.status < 300,
      "REST < 500ms": (r) => r.timings.duration < 500,
    },
    { kind: "rest" }
  );

  if (!restOk) {
    rest_fail.add(1);
    const body = restRes.body ? String(restRes.body) : "";
    console.log(`REST ${restPath} -> ${restRes.status} body=${body.slice(0, 200)}`);
  } else if (DEBUG) {
    console.log(`REST OK ${restPath} -> ${restRes.status} (${Math.round(restRes.timings.duration)}ms)`);
  }

  // WS (público)
  const wsRes = ws.connect(
    `${WS_URL}/`,
    { tags: { kind: "ws", name: "WS connect" } },
    (socket) => {
      socket.on("open", () => {
        // se seu WS usa join room, coloque o tournamentId aqui:
        // socket.send(JSON.stringify({ type: "join", room: tournamentId }));

        socket.setTimeout(() => socket.close(), 30000);
      });
    }
  );

  check(wsRes, { "WS handshake 101": (r) => r && r.status === 101 }, { kind: "ws" });

  sleep(1);
}
