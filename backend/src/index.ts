import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ArenaState, Robot, Match, GroupTableItem } from "./types";

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = Number(process.env.PORT || 8080);

/* ------------------ ESTADO GLOBAL ------------------ */
let state: ArenaState = {
  robots: [],
  matches: [],
  currentMatchId: null,
  mainTimer: 0,
  mainStatus: "idle",
  recoveryTimer: 0,
  recoveryActive: false,
  winner: null,
  lastWinner: null,
  ranking: [],
  groupTables: {}
};

/* ------------------ UTILITÁRIOS ------------------ */
function broadcast(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients)
    if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------ TIMERS ------------------ */
let mainTick: NodeJS.Timeout | null = null;
let recoveryTick: NodeJS.Timeout | null = null;

function stopAllTimers() {
  if (mainTick) clearInterval(mainTick);
  if (recoveryTick) clearInterval(recoveryTick);
  mainTick = null;
  recoveryTick = null;
}

function resetTimers() {
  stopAllTimers();
  state.mainTimer = 0;
  state.recoveryTimer = 0;
  state.mainStatus = "idle";
  state.recoveryActive = false;
}

function setCurrentMatch(id: string | null) {
  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  if (id) state.winner = null;
  broadcast("UPDATE_STATE", { state });
}

function startMainTimer(seconds = 180) {
  stopAllTimers();
  state.mainTimer = seconds;
  state.mainStatus = "running";
  broadcast("UPDATE_STATE", { state });
  mainTick = setInterval(() => {
    if (state.mainStatus !== "running") return;
    state.mainTimer = Math.max(0, state.mainTimer - 1);
    broadcast("UPDATE_STATE", { state });
    if (state.mainTimer === 0) endMatchNow();
  }, 1000);
}

function startRecoveryTimer(seconds = 10) {
  if (state.mainStatus === "running") {
    state.mainStatus = "paused";
    if (mainTick) clearInterval(mainTick);
  }
  state.recoveryActive = true;
  state.recoveryTimer = seconds;
  broadcast("UPDATE_STATE", { state });

  recoveryTick = setInterval(() => {
    if (!state.recoveryActive) return;
    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcast("UPDATE_STATE", { state });

    if (state.recoveryTimer === 0) {
      clearInterval(recoveryTick!);
      state.recoveryActive = false;
      if (state.mainTimer > 0) startMainTimer(state.mainTimer);
      else endMatchNow();
    }
  }, 1000);
}

function endMatchNow() {
  stopAllTimers();
  state.mainStatus = "finished";
  state.recoveryActive = false;
  broadcast("UPDATE_STATE", { state });
}

/* ------------------ CHAVEAMENTO DINÂMICO ------------------ */

// Divide robôs em grupos balanceados e evita grupos vazios ou de 1 robô
function divideGroupsDynamic(robots: Robot[], groupCount: number, robotsPerGroup: number): Robot[][] {
  const shuffled = shuffle(robots);
  const groups: Robot[][] = Array.from({ length: groupCount }, () => []);

  let gi = 0;
  for (const r of shuffled) {
    groups[gi].push(r);
    gi = (gi + 1) % groupCount;
  }

  // Ajuste se algum grupo tiver 1 robô
  const hasSingle = () => groups.some(g => g.length === 1);
  while (hasSingle()) {
    let largest = groups.reduce((a, b) => (a.length > b.length ? a : b));
    let smallest = groups.find(g => g.length === 1);
    if (!smallest || largest.length <= 2) break;
    smallest.push(largest.pop()!);
  }

  return groups.filter(g => g.length > 0);
}

// Todos contra todos (sem repetição)
function generateGroupMatches(groups: Robot[][]): Match[] {
  const matches: Match[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = [...groups[gi]]; // cópia para manipular
    const label = String.fromCharCode(65 + gi); // A, B, C...
    const n = group.length;

    // se número ímpar, adiciona "bye" (folga)
    if (n % 2 !== 0) group.push({ id: "bye", name: "Folga" } as Robot);

    const totalRounds = group.length - 1;
    const half = group.length / 2;

    // gera rodadas balanceadas
    for (let round = 0; round < totalRounds; round++) {
      const rodada: [Robot, Robot][] = [];
      for (let i = 0; i < half; i++) {
        const a = group[i];
        const b = group[group.length - 1 - i];
        if (a.id !== "bye" && b.id !== "bye") {
          rodada.push([a, b]);
        }
      }

      // adiciona as partidas dessa rodada
      for (const [A, B] of rodada) {
        matches.push({
          id: uuidv4(),
          phase: "groups",
          round: round + 1,
          group: label,
          robotA: A,
          robotB: B,
          scoreA: 0,
          scoreB: 0,
          winner: null,
          finished: false
        });
      }

      // rotaciona os robôs (exceto o primeiro)
      const fixed = group[0];
      const rest = group.slice(1);
      rest.unshift(rest.pop()!);
      group.splice(0, group.length, fixed, ...rest);
    }
  }

  return matches;
}


/* ------------------ TABELAS ------------------ */
function makeItem(r: Robot): GroupTableItem {
  return { robotId: r.id, name: r.name, team: r.team, pts: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0 };
}

function computeGroupTables(): Record<string, GroupTableItem[]> {
  const tables: Record<string, Record<string, GroupTableItem>> = {};
  const groupMatches = state.matches.filter(m => m.phase === "groups");
  const groups = Array.from(new Set(groupMatches.map(m => m.group).filter(Boolean))) as string[];

  for (const g of groups) tables[g] = {};

  for (const m of groupMatches) {
    const g = m.group as string;
    const A = m.robotA?.id; const B = m.robotB?.id;
    if (!A || !B) continue;

    if (!tables[g][A]) tables[g][A] = makeItem(m.robotA!);
    if (!tables[g][B]) tables[g][B] = makeItem(m.robotB!);
    if (!m.finished) continue;

    tables[g][A].gf += m.scoreA; tables[g][A].ga += m.scoreB;
    tables[g][B].gf += m.scoreB; tables[g][B].ga += m.scoreA;

    if (m.scoreA > m.scoreB) { tables[g][A].pts += 3; tables[g][A].wins++; tables[g][B].losses++; }
    else if (m.scoreB > m.scoreA) { tables[g][B].pts += 3; tables[g][B].wins++; tables[g][A].losses++; }
    else { tables[g][A].pts++; tables[g][B].pts++; tables[g][A].draws++; tables[g][B].draws++; }
  }

  const out: Record<string, GroupTableItem[]> = {};
  for (const g of Object.keys(tables)) {
    const arr = Object.values(tables[g]).map(x => ({ ...x, gd: x.gf - x.ga }));
    arr.sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name)
    );
    out[g] = arr;
  }
  return out;
}

/* ------------------ ELIMINATÓRIAS ------------------ */
function generateEliminationFromGroups() {
  const tables = computeGroupTables();
  state.groupTables = tables;
  const groupNames = Object.keys(tables).sort();
  const advancePerGroup = (state as any).advancePerGroup || 2;

  const qualified: { group: string; robot: Robot }[] = [];
  for (const g of groupNames) {
    const top = tables[g].slice(0, advancePerGroup);
    for (const t of top) {
      const robot = state.robots.find(r => r.id === t.robotId);
      if (robot) qualified.push({ group: g, robot });
    }
  }

  const elimMatches: Match[] = [];
  const half = Math.ceil(qualified.length / 2);
  const left = qualified.slice(0, half);
  const right = qualified.slice(half).reverse();

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    elimMatches.push({
      id: uuidv4(),
      phase: "elimination",
      round: 1,
      group: null,
      robotA: left[i].robot,
      robotB: right[i].robot,
      scoreA: 0,
      scoreB: 0,
      winner: null,
      finished: false
    });
  }

  // rounds seguintes
  let curr = elimMatches.length;
  let round = 1;
  while (curr > 1) {
    const nextCount = Math.ceil(curr / 2);
    for (let i = 0; i < nextCount; i++) {
      elimMatches.push({
        id: uuidv4(),
        phase: "elimination",
        round: round + 1,
        group: null,
        robotA: null,
        robotB: null,
        scoreA: 0,
        scoreB: 0,
        winner: null,
        finished: false
      });
    }
    curr = nextCount;
    round++;
  }

  state.matches.push(...elimMatches);
  const first = state.matches.find(m => !m.finished);
  setCurrentMatch(first?.id || null);
  broadcast("UPDATE_STATE", { state });
}

/* ------------------ FINALIZAÇÃO ------------------ */
function finalizeMatch(id: string, scoreA: number, scoreB: number) {
  const m = state.matches.find(mm => mm.id === id);
  if (!m) return;

  m.finished = true;
  m.scoreA = scoreA;
  m.scoreB = scoreB;
  if (m.robotA && m.robotB) {
    if (scoreA > scoreB) m.winner = m.robotA;
    else if (scoreB > scoreA) m.winner = m.robotB;
  }

  state.winner = m.winner;
  state.lastWinner = m.winner;
  state.groupTables = computeGroupTables();

  if (m.phase === "groups") {
    const allGroupsDone = state.matches.filter(x => x.phase === "groups").every(x => x.finished);
    if (allGroupsDone) generateEliminationFromGroups();
  } else {
    const round = m.round;
    const currentRound = state.matches.filter(x => x.phase === "elimination" && x.round === round);
    if (currentRound.every(x => x.finished)) {
      const winners = currentRound.map(x => x.winner).filter(Boolean) as Robot[];
      const nextRound = state.matches.filter(x => x.phase === "elimination" && x.round === round + 1);
      for (let i = 0; i < winners.length; i++) {
        const target = nextRound[Math.floor(i / 2)];
        if (!target) continue;
        if (i % 2 === 0) target.robotA = winners[i];
        else target.robotB = winners[i];
      }
    }
  }

  const next = state.matches.find(x => !x.finished);
  if (next) setCurrentMatch(next.id);
  else {
    state.currentMatchId = null;
    state.mainStatus = "finished";
  }
  broadcast("UPDATE_STATE", { state });
}

/* ------------------ GERAÇÃO PRINCIPAL ------------------ */
function generateTournament(groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2) {
  const robots = [...state.robots];
  if (robots.length < 2) {
    state.matches = [];
    state.groupTables = {};
    state.currentMatchId = null;
    broadcast("UPDATE_STATE", { state });
    return;
  }

  let groups = divideGroupsDynamic(robots, groupCount, robotsPerGroup);
  if (groups.length === 1) groups = [groups[0]];

  const groupMatches = generateGroupMatches(groups);

  state.matches = groupMatches;
  state.lastWinner = null;
  (state as any).advancePerGroup = advancePerGroup;
  (state as any).groupCount = groups.length;
  state.groupTables = computeGroupTables();
  state.currentMatchId = groupMatches[0]?.id ?? null;
  broadcast("UPDATE_STATE", { state });
}

/* ------------------ INÍCIO DE LUTA ------------------ */
function startMatch(id: string) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;

  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  state.winner = null;

  broadcast("UPDATE_STATE", { state });
  console.log(`🎮 Combate iniciado: ${match.robotA?.name} vs ${match.robotB?.name}`);
}

/* ------------------ ENDPOINTS ------------------ */
app.get("/state", (_req, res) => res.json({ state }));

app.post("/robots", (req, res) => {
  const { name, team, image, score } = req.body;
  const robot: Robot = { id: uuidv4(), name, team, image, score: score || 0 };
  state.robots.push(robot);
  broadcast("UPDATE_STATE", { state });
  res.json(robot);
});

app.post("/matches/generate", (req, res) => {
  let { groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2 } = req.body || {};
  const total = state.robots.length;
  groupCount = Math.max(1, Math.min(groupCount, total));
  robotsPerGroup = Math.max(2, robotsPerGroup);
  advancePerGroup = Math.max(1, advancePerGroup);
  generateTournament(groupCount, robotsPerGroup, advancePerGroup);
  res.json({ ok: true });
});

app.post("/matches/:id/start", (req, res) => {
  startMatch(req.params.id);
  res.json({ ok: true });
});

app.post("/matches/:id/result", (req, res) => {
  const { scoreA, scoreB } = req.body;
  finalizeMatch(req.params.id, Number(scoreA), Number(scoreB));
  res.json({ ok: true });
});

app.post("/arena/reset", (_req, res) => {
  stopAllTimers();
  state = {
    robots: [],
    matches: [],
    currentMatchId: null,
    mainTimer: 0,
    mainStatus: "idle",
    recoveryTimer: 0,
    recoveryActive: false,
    winner: null,
    lastWinner: null,
    ranking: [],
    groupTables: {}
  };
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

app.post("/matches/:id/judges", (req, res) => {
  const match = state.matches.find((m) => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: "Match not found" });

  const { judges, decision, winnerId } = req.body; // Recebe as pontuações dos jurados e a decisão de K.O ou W.O
  let totalA = 0, totalB = 0;

  // Se for K.O ou W.O, aplica 33 pontos ao vencedor
  if (decision === "KO" || decision === "WO") {
    // Verifica qual robô foi selecionado para ganhar
    match.scoreA = winnerId === match.robotA?.id ? 33 : 0;
    match.scoreB = winnerId === match.robotB?.id ? 33 : 0;

    match.winner = winnerId === match.robotA?.id ? match.robotA : match.robotB;
    match.finished = true;
  } else {
    // Caso contrário, calcula a pontuação para cada robô
    judges.forEach((j: any) => {
      totalA += j.damageA + j.hitsA;
      totalB += j.damageB + j.hitsB;
    });

    // Atualiza a pontuação final no combate
    match.scoreA = totalA;
    match.scoreB = totalB;
    if (totalA === totalB) {
      match.winner = null; // Nenhum vencedor
    } else {
      match.winner = totalA > totalB ? match.robotA : match.robotB;
    }
    match.finished = true;
  }

  // Atualiza os robôs com a pontuação final
  if (match.robotA) updateRobotScore(match.robotA.id, match.scoreA);
  if (match.robotB) updateRobotScore(match.robotB.id, match.scoreB);

  state.winner = match.winner;

  // Atualiza o estado global
  broadcast("UPDATE_STATE", { state });

  // Responde com o resultado do combate
  res.json({ ok: true, result: match });
});


// Função auxiliar para atualizar o robô com a pontuação
function updateRobotScore(robotId: string, scoreAtual: number) {
  const robot = state.robots.find((r) => r.id === robotId);
  if (robot) {
    robot.score = (robot.score || 0) + scoreAtual; // Acumula a pontuação do robô
    console.log(`✅ Pontuação do robô ${robot.name}: ${robot.score}`);
  }
}

app.delete("/robots/:id", (req, res) => {
  state.robots = state.robots.filter(r => r.id !== req.params.id);
  state.matches = state.matches.filter(m => m.robotA?.id !== req.params.id && m.robotB?.id !== req.params.id);
  if (state.currentMatchId && !state.matches.find(m => m.id === state.currentMatchId)) setCurrentMatch(null);
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true });
});

/* ------------------ WEBSOCKET ------------------ */
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MAIN": startMainTimer(payload?.seconds ?? 180); break;
        case "PAUSE_MAIN": state.mainStatus = "paused"; break;
        case "RESUME_MAIN": if (state.mainTimer > 0) startMainTimer(state.mainTimer); break;
        case "RESET_MAIN": resetTimers(); broadcast("UPDATE_STATE", { state }); break;
        case "START_RECOVERY": startRecoveryTimer(payload?.seconds ?? 10); break;
        case "END_MATCH": endMatchNow(); break;
      }
    } catch {}
  });
});

server.listen(PORT, () =>
  console.log(`✅ Arena backend v6.1 (chaveamento dinâmico configurável) @${PORT}`)
);

console.log(state);