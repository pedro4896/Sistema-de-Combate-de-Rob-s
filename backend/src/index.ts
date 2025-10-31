import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ArenaState, Robot, Match, GroupTableItem } from "./types";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Client, QueryResult } from "pg"; // 👈 Importa o cliente PG

const SECRET_KEY = process.env.ARENA_SECRET || "arena_secret_2025";
const PORT = Number(process.env.PORT || 8080);

const adminUser = {
  username: "admin",
  passwordHash: bcrypt.hashSync("123456", 8),
  role: "admin",
};

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server });

/* ------------------ ESTADO GLOBAL E DB ------------------ */

// Estado inicial padrão (fallback)
const defaultState: ArenaState = {
  robots: [],
  matches: [],
  currentMatchId: null,
  mainTimer: 0,
  mainStatus: "idle",
  recoveryTimer: 0,
  recoveryActive: false,
  recoveryPaused: false,
  winner: null,
  lastWinner: null,
  ranking: [],
  groupTables: {}
};

// Variável para armazenar o estado em memória e a conexão DB
let state: ArenaState = defaultState;
let dbClient: Client | null = null;

// Função para salvar o estado atual no PostgreSQL
async function saveState() {
  if (!dbClient) return;
  try {
    const payload = JSON.stringify(state);
    const sql = `
      INSERT INTO arena_state (id, data)
      VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE
      SET data = $1, updated_at = NOW();
    `;
    await dbClient.query(sql, [payload]);
  } catch (error) {
    console.error("❌ Erro ao salvar estado no DB:", error);
  }
}

// Função para carregar o estado do PostgreSQL
async function loadState(): Promise<ArenaState> {
  if (!dbClient) return defaultState;
  try {
    const res: QueryResult<{ data: ArenaState }> = await dbClient.query(
      "SELECT data FROM arena_state WHERE id = 1"
    );
    if (res.rows.length > 0) {
      console.log("✅ Estado carregado do banco de dados.");
      return res.rows[0].data as ArenaState;
    }
  } catch (error) {
    console.warn("⚠️ Tabela 'arena_state' não encontrada ou erro ao carregar. Tentando criar...");
    // Cria a tabela se não existir (se a falha foi por tabela inexistente)
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS arena_state (
        id INT PRIMARY KEY,
        data JSONB,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);
    // Insere o estado inicial se não houver registros
    await dbClient.query("INSERT INTO arena_state (id, data) VALUES (1, $1) ON CONFLICT DO NOTHING", [JSON.stringify(defaultState)]);
    console.log("🛠️ Tabela 'arena_state' criada e inicializada.");
  }
  return defaultState;
}

// Função para recarregar o estado do DB e transmitir a todos os clientes
async function loadStateFromDBAndBroadcast() {
  state = await loadState();
  broadcast("UPDATE_STATE", { state });
  console.log("🔄 Estado recarregado do banco de dados e transmitido.");
}


// Inicialização e Conexão ao DB
async function initDBAndServer() {
  // Configuração do cliente PG com fallbacks para rodar localmente
  const POSTGRES_HOST = process.env.POSTGRES_HOST || "localhost"; 
  const POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5432); 
  const POSTGRES_USER = process.env.POSTGRES_USER || "postgres"; 
  const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "root";
  const POSTGRES_DB = process.env.POSTGRES_DB || "arenaCombate";

  const connectionConfig = {
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
  };
  
  // Agora usamos o objeto de configuração, que é mais seguro do que a concatenação manual de strings com variáveis indefinidas.
  dbClient = new Client(connectionConfig); 
  
  try {
    await dbClient.connect();
    console.log("✅ Conectado ao PostgreSQL");

    // Tenta carregar o estado
    state = await loadState();
    if (state === defaultState) {
      // Se carregou o estado padrão (porque não havia registro), salva ele no banco
      await saveState(); 
    }

    // Inicia o servidor Express e WebSocket
    server.listen(PORT, () =>
      console.log(`✅ Arena backend rodando @${PORT}`)
    );

  } catch (error) {
    console.error("❌ Falha ao conectar ao PostgreSQL:", error);
    process.exit(1); // Sai do processo se a conexão falhar
  }
}

// Chama a função de inicialização
initDBAndServer();

/* ------------------ UTILITÁRIOS & FUNÇÕES CORE ------------------ */

// Adapta a função broadcast para também salvar o estado
function broadcastAndSave(type: string, payload: any) {
  broadcast(type, payload);
  saveState(); // Salva após qualquer alteração que dispara broadcast
}

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
  state.recoveryPaused = false;
}

function setCurrentMatch(id: string | null) {
  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  if (id) state.winner = null;
  broadcastAndSave("UPDATE_STATE", { state });
}

function startMainTimer(seconds = 180) {
  stopAllTimers();
  state.mainTimer = seconds;
  state.mainStatus = "running";
  broadcastAndSave("UPDATE_STATE", { state });
  mainTick = setInterval(() => {
    if (state.mainStatus !== "running") return;
    state.mainTimer = Math.max(0, state.mainTimer - 1);
    broadcastAndSave("UPDATE_STATE", { state });
    if (state.mainTimer === 0) endMatchNow();
  }, 1000);
}

function startRecoveryTimer(seconds = 10, resume = false) {
  if (!resume && state.mainStatus === "running") {
    state.mainStatus = "paused";
    if (mainTick) clearInterval(mainTick);
  }

  if (recoveryTick) clearInterval(recoveryTick);
  state.recoveryActive = true;
  state.recoveryPaused = false;
  state.recoveryTimer = seconds;
  broadcastAndSave("UPDATE_STATE", { state });

  recoveryTick = setInterval(() => {
    if (state.recoveryPaused) return;

    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcastAndSave("UPDATE_STATE", { state });

    if (state.recoveryTimer === 0) {
      clearInterval(recoveryTick!);
      state.recoveryActive = true;
      state.recoveryPaused = false;
      broadcastAndSave("UPDATE_STATE", { state });

      if (state.mainTimer > 0) startMainTimer(state.mainTimer);
      else endMatchNow();
    }
  }, 1000);
}

function endMatchNow() {
  stopAllTimers();
  state.mainStatus = "finished";
  state.recoveryActive = false;
  broadcastAndSave("UPDATE_STATE", { state });
}

function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Sem token" });
  try {
    jwt.verify(token, SECRET_KEY);
    next();
  } catch {
    res.status(403).json({ error: "Token inválido" });
  }
}

/* ------------------ CHAVEAMENTO DINÂMICO ------------------ */

function divideGroupsDynamic(robots: Robot[], groupCount: number, robotsPerGroup: number): Robot[][] {
  const shuffled = shuffle(robots);
  const groups: Robot[][] = Array.from({ length: groupCount }, () => []);

  let gi = 0;
  for (const r of shuffled) {
    groups[gi].push(r);
    gi = (gi + 1) % groupCount;
  }

  const hasSingle = () => groups.some(g => g.length === 1);
  while (hasSingle()) {
    let largest = groups.reduce((a, b) => (a.length > b.length ? a : b));
    let smallest = groups.find(g => g.length === 1);
    if (!smallest || largest.length <= 2) break;
    smallest.push(largest.pop()!);
  }

  return groups.filter(g => g.length > 0);
}

function generateGroupMatches(groups: Robot[][]): Match[] {
  const matches: Match[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = [...groups[gi]];
    const label = String.fromCharCode(65 + gi);
    const n = group.length;

    if (n % 2 !== 0) group.push({ id: "bye", name: "Folga" } as Robot);

    const totalRounds = group.length - 1;
    const half = group.length / 2;

    for (let round = 0; round < totalRounds; round++) {
      const rodada: [Robot, Robot][] = [];
      for (let i = 0; i < half; i++) {
        const a = group[i];
        const b = group[group.length - 1 - i];
        if (a.id !== "bye" && b.id !== "bye") {
          rodada.push([a, b]);
        }
      }

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
          finished: false,
          type: "normal"
        } as Match);
      }

      const fixed = group[0];
      const rest = group.slice(1);
      rest.unshift(rest.pop()!);
      group.splice(0, group.length, fixed, ...rest);
    }
  }

  return matches;
}

function makeItem(r: Robot): GroupTableItem {
  return { robotId: r.id, name: r.name, team: r.team, pts: 0, wins: 0, draws: 0, losses: 0, ko: 0, wo: 0 } as GroupTableItem;
}


function computeGroupTables(): Record<string, GroupTableItem[]> {
  const tables: Record<string, Record<string, GroupTableItem>> = {};
  const groupMatches = state.matches.filter((m) => m.phase === "groups");

  const groups = Array.from(
    new Set(groupMatches.map((m) => m.group).filter(Boolean))
  );

  for (const g of groups) tables[g] = {};

  for (const m of groupMatches) {
    const g = m.group!;
    const A = m.robotA?.id;
    const B = m.robotB?.id;
    if (!A || !B) continue;

    if (!tables[g][A]) tables[g][A] = makeItem(m.robotA!);
    if (!tables[g][B]) tables[g][B] = makeItem(m.robotB!);
    if (!m.finished) continue;

    // Pontuação padrão
    if (m.scoreA > m.scoreB) {
      tables[g][A].pts += 3; tables[g][A].wins++; tables[g][B].losses++;
    } else if (m.scoreB > m.scoreA) {
      tables[g][B].pts += 3; tables[g][B].wins++; tables[g][A].losses++;
    } else {
      tables[g][A].pts++; tables[g][B].pts++;
      tables[g][A].draws++; tables[g][B].draws++;
    }

    // Contabiliza KO e WO
    if (m.type === "KO" && m.winner) {
      tables[g][m.winner.id].ko = (tables[g][m.winner.id]?.ko || 0) + 1;
    }
    if (m.type === "WO" && m.winner) {
      tables[g][m.winner.id].wo = (tables[g][m.winner.id]?.wo || 0) + 1;
    }
  }

  const out: Record<string, GroupTableItem[]> = {};
  for (const g of Object.keys(tables)) {
    const arr = Object.values(tables[g]);
    arr.sort(
      (a, b) =>
        b.pts - a.pts ||
        b.wins - a.wins ||
        a.name.localeCompare(b.name)
    );
    out[g] = arr;
  }
  return out;
}


function generateGroupEliminations() {
  const tables = computeGroupTables();
  state.groupTables = tables;
  const advancePerGroup = (state as any).advancePerGroup || 2;

  for (const g in tables) {
    const already = state.matches.some(
      (m) => m.phase === "elimination" && m.group === g
    );
    if (already) continue;

    const top = tables[g].slice(0, advancePerGroup);
    const qualified = top
      .map((r) => state.robots.find((x) => x.id === r.robotId))
      .filter(Boolean) as Robot[];

    if (qualified.length < 2) continue;

    const shuffled = [...qualified].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i += 2) {
      const A = shuffled[i];
      const B = shuffled[i + 1];
      const isBye = !B;
      const winner = isBye ? A : null;

      state.matches.push({
        id: uuidv4(),
        phase: "elimination",
        round: 1,
        group: g,
        robotA: A,
        robotB: B || { id: "bye", name: "BYE", team: "", image: "" },
        scoreA: isBye ? 33 : 0,
        scoreB: 0,
        winner,
        finished: !!isBye,
        type: isBye ? "WO" : "normal",
      } as Match);
    }
  }

  broadcastAndSave("UPDATE_STATE", { state });
  console.log("🏁 Eliminatórias internas dos grupos criadas!");
}

function checkAndGenerateGrandFinal() {
  const groupLabels = Object.keys(state.groupTables || {});
  if (groupLabels.length === 0) return;

  const champions: Robot[] = [];

  for (const g of groupLabels) {
    const gMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g)
      .sort((a, b) => a.round - b.round);

    if (gMatches.length === 0) return;

    const rounds = [...new Set(gMatches.map((m) => m.round))].sort((a, b) => a - b);
    const lastRound = rounds[rounds.length - 1];
    const lastRoundMatches = gMatches.filter((m) => m.round === lastRound);

    const allFinished = lastRoundMatches.every((m) => m.finished);
    if (!allFinished) return;

    const winners = lastRoundMatches.filter((m) => m.winner).map((m) => m.winner).filter(Boolean) as Robot[];
    if (winners.length === 1) champions.push(winners[0]);
    else return;
  }

  const already = state.matches.some(
    (m) => m.phase === "elimination" && !m.group
  );
  if (already) return;

  if (champions.length < 2) return;

  const BYE = { id: "bye", name: "BYE", team: "", image: "" } as Robot;
  const shuffled = [...champions].sort(() => Math.random() - 0.5);
  if (shuffled.length % 2 !== 0) shuffled.push(BYE);

  const finals: Match[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const A = shuffled[i];
    const B = shuffled[i + 1];
    const isBye = A.id === "bye" || B.id === "bye";
    const winner = isBye ? (A.id !== "bye" ? A : B) : null;

    finals.push({
      id: uuidv4(),
      phase: "elimination",
      round: 1,
      group: null,
      robotA: A.id !== "bye" ? A : null,
      robotB: B.id !== "bye" ? B : null,
      scoreA: isBye && winner?.id === A.id ? 33 : 0,
      scoreB: isBye && winner?.id === B.id ? 33 : 0,
      winner,
      finished: !!isBye,
      type: isBye ? "WO" : "normal",
    } as Match);
  }

  state.matches.push(...finals);
  broadcastAndSave("UPDATE_STATE", { state });
  console.log("🏆 Mata-mata final entre campeões gerado!");
}


function progressGroupEliminations() {
  const groupLabels = Object.keys(state.groupTables || {});
  for (const g of groupLabels) {
    const groupMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g)
      .sort((a, b) => a.round - b.round);

    if (groupMatches.length === 0) continue;

    const rounds = [...new Set(groupMatches.map((m) => m.round))].sort(
      (a, b) => a - b
    );
    const lastRound = rounds[rounds.length - 1];
    const lastMatches = groupMatches.filter((m) => m.round === lastRound);

    const allFinished = lastMatches.every((m) => m.finished);
    if (!allFinished) continue;

    const winners = lastMatches
      .filter((m) => m.winner)
      .map((m) => m.winner) as Robot[];

    if (winners.length <= 1) continue;

    const nextRound = lastRound + 1;
    const BYE = { id: "bye", name: "BYE", team: "", image: "" } as Robot;
    const shuffled = [...winners].sort(() => Math.random() - 0.5);
    if (shuffled.length % 2 !== 0) shuffled.push(BYE);

    const nextMatches: Match[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      const A = shuffled[i];
      const B = shuffled[i + 1];
      const isBye = A.id === "bye" || B.id === "bye";
      const winner = isBye ? (A.id !== "bye" ? A : B) : null;

      nextMatches.push({
        id: uuidv4(),
        phase: "elimination",
        round: nextRound,
        group: g,
        robotA: A.id !== "bye" ? A : null,
        robotB: B.id !== "bye" ? B : null,
        scoreA: isBye && winner?.id === A.id ? 33 : 0,
        scoreB: isBye && winner?.id === B.id ? 33 : 0,
        winner,
        finished: !!isBye,
        type: isBye ? "WO" : "normal",
      } as Match);
    }

    state.matches.push(...nextMatches);
    broadcastAndSave("UPDATE_STATE", { state });
    console.log(`🏁 Nova rodada criada no grupo ${g} (Round ${nextRound})`);
  }
}

function updateGroupChampions() {
  const groupLabels = Object.keys(state.groupTables || {});
  for (const g of groupLabels) {
    const gMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g)
      .sort((a, b) => a.round - b.round);

    if (gMatches.length === 0) continue;

    const rounds = [...new Set(gMatches.map((m) => m.round))].sort((a, b) => a - b);
    const lastRound = rounds[rounds.length - 1];
    const lastRoundMatches = gMatches.filter((m) => m.round === lastRound);

    const allFinished = lastRoundMatches.every((m) => m.finished);
    if (!allFinished) continue;

    const table = state.groupTables![g] as (GroupTableItem & { isChampion?: boolean })[];
    const alreadyHas = table.some((r) => r.isChampion);
    if (alreadyHas) continue;

    const winners = lastRoundMatches.filter((m) => m.winner).map((m) => m.winner) as Robot[];
    if (winners.length === 1) {
      const champ = winners[0];
      for (const r of table) r.isChampion = r.robotId === champ.id;
      console.log(`🏅 Campeão do grupo ${g}: ${champ.name}`);
    }
  }

  broadcastAndSave("UPDATE_STATE", { state });
}

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
      finished: false,
      type: "normal"
    });
  }

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
        finished: false,
        type: "normal"
      });
    }
    curr = nextCount;
    round++;
  }

  state.matches.push(...elimMatches);
  const first = state.matches.find(m => !m.finished);
  setCurrentMatch(first?.id || null);
  broadcastAndSave("UPDATE_STATE", { state });
}

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
  m.type = "normal";

  state.winner = m.winner;
  state.lastWinner = m.winner;
  state.groupTables = computeGroupTables();

  if (m.phase === "groups") {
    const allGroupsDone = state.matches.filter(x => x.phase === "groups").every(x => x.finished);
    if (allGroupsDone) generateEliminationFromGroups();
  } else {
    const round = m.round;
    const currentMatchesInRound = state.matches.filter(x => x.phase === "elimination" && x.round === round && x.group === m.group);
    
    if (currentMatchesInRound.every(x => x.finished)) {
        const winners = currentMatchesInRound.map(x => x.winner).filter(Boolean) as Robot[];
        const nextRoundMatches = state.matches.filter(x => x.phase === "elimination" && x.round === round + 1 && x.group === m.group);

        for (let i = 0; i < winners.length; i++) {
            const target = nextRoundMatches[Math.floor(i / 2)];
            if (!target) continue;
            if (i % 2 === 0) target.robotA = winners[i];
            else target.robotB = winners[i];
        }

        if (m.group) {
          progressGroupEliminations();
          updateGroupChampions();
          checkAndGenerateGrandFinal();
        }
    }
  }

  const next = state.matches.find(x => !x.finished);
  if (next) setCurrentMatch(next.id);
  else {
    state.currentMatchId = null;
    state.mainStatus = "finished";
  }
  broadcastAndSave("UPDATE_STATE", { state });
}

function generateTournament(groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2) {
  const robots = [...state.robots];
  if (robots.length < 2) {
    state.matches = [];
    state.groupTables = {};
    state.currentMatchId = null;
    broadcastAndSave("UPDATE_STATE", { state });
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
  broadcastAndSave("UPDATE_STATE", { state });
}

function startMatch(id: string) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;

  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  state.winner = null;

  broadcastAndSave("UPDATE_STATE", { state });
  console.log(`🎮 Combate iniciado: ${match.robotA?.name} vs ${match.robotB?.name}`);
}

function updateRobotScore(robotId: string, scoreAtual: number) {
  const robot = state.robots.find((r) => r.id === robotId);
  if (robot) {
    robot.score = (robot.score || 0) + scoreAtual;
    console.log(`✅ Pontuação do robô ${robot.name}: ${robot.score}`);
  }
}

/* ------------------ ENDPOINTS ------------------ */
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== adminUser.username) return res.status(401).json({ error: "Usuário incorreto" });
  if (!bcrypt.compareSync(password, adminUser.passwordHash))
    return res.status(401).json({ error: "Senha incorreta" });

  const token = jwt.sign({ role: "admin" }, SECRET_KEY, { expiresIn: "6h" });
  res.json({ token });
});

// 🔓 Rotas públicas
app.get("/state", (_req, res) => res.json({ state }));
app.get("/ranking", (_req, res) => {
  const robotMap = Object.fromEntries(state.robots.map(r => [r.id, r]));

  const matches = state.matches.filter(
    (m) => m.phase === "groups" || m.phase === "elimination"
  );

  const table: Record<string, any> = {};

  for (const m of matches) {
    if (!m.finished || !m.robotA || !m.robotB) continue;
    const { robotA, robotB } = m;

    const currentA = robotMap[robotA.id] || robotA;
    const currentB = robotMap[robotB.id] || robotB;

    if (!table[currentA.id])
      table[currentA.id] = {
        ...currentA,
        pts: currentA.score || 0,
        wins: 0,
        losses: 0,
        draws: 0,
        ko: 0,
        wo: 0,
      };
    if (!table[currentB.id])
      table[currentB.id] = {
        ...currentB,
        pts: currentB.score || 0,
        wins: 0,
        losses: 0,
        draws: 0,
        ko: 0,
        wo: 0,
      };

    if (m.scoreA > m.scoreB) {
      table[currentA.id].wins++;
      table[currentB.id].losses++;
    } else if (m.scoreB > m.scoreA) {
      table[currentB.id].wins++;
      table[currentA.id].losses++;
    } else {
      table[currentA.id].draws++;
      table[currentB.id].draws++;
    }

    if (m.type === "KO" && m.winner)
      table[m.winner.id].ko = (table[m.winner.id]?.ko || 0) + 1;
    if (m.type === "WO" && m.winner)
      table[m.winner.id].wo = (table[m.winner.id]?.wo || 0) + 1;
  }

  for (const r of state.robots) {
    if (!table[r.id]) {
      table[r.id] = {
        ...r,
        pts: r.score || 0,
        wins: 0,
        losses: 0,
        draws: 0,
        ko: 0,
        wo: 0,
      };
    } else {
      table[r.id].name = r.name;
      table[r.id].team = r.team;
      table[r.id].image = r.image;
    }
  }

  const ranking = Object.values(table).sort(
    (a: any, b: any) =>
      b.pts - a.pts ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name)
  );

  res.json({ ok: true, ranking });
});


// 🔒 Rotas protegidas (somente admin autenticado)
app.use(authenticateToken);

// 🆕 Rotas de Gerenciamento do Banco de Dados
app.post("/db/save", async (_req, res) => {
  await saveState();
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true, message: "Estado atual salvo no banco de dados." });
});

app.post("/db/load", async (_req, res) => {
  await loadStateFromDBAndBroadcast();
  res.json({ ok: true, message: "Estado recarregado do banco de dados." });
});


// Rotas CRUD de Robôs e Partidas
app.post("/robots", (req, res) => {
  const { name, team, image, score } = req.body;
  const robot: Robot = { id: uuidv4(), name, team, image, score: score || 0 };
  state.robots.push(robot);
  broadcastAndSave("UPDATE_STATE", { state });
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

app.post("/matches/elimination", (req, res) => {
  const { matches } = req.body;
  state.matches.push(...matches);
  broadcastAndSave("UPDATE_STATE", { state });
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

app.post("/arena/reset", async (_req, res) => {
  stopAllTimers();
  state = { ...defaultState };
  
  if (dbClient) {
    // É mais seguro fazer um DELETE + INSERT para resetar
    await dbClient.query("DELETE FROM arena_state WHERE id = 1"); 
    await dbClient.query("INSERT INTO arena_state (id, data) VALUES (1, $1)", [JSON.stringify(state)]);
  }

  broadcastAndSave("UPDATE_STATE", { state });
  res.json({ ok: true });
});

app.post("/matches/:id/judges", (req, res) => {
  const match = state.matches.find((m) => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: "Match not found" });

  const { judges, decision, winnerId } = req.body;
  let totalA = 0, totalB = 0;

  if (decision === "KO" || decision === "WO") {
    match.scoreA = winnerId === match.robotA?.id ? 33 : 0;
    match.scoreB = winnerId === match.robotB?.id ? 33 : 0;

    match.winner = winnerId === match.robotA?.id ? match.robotA : match.robotB;
    match.finished = true;
    match.type = decision === "KO" ? "KO" : "WO";
  } else {
    judges.forEach((j: any) => {
      totalA += j.damageA + j.hitsA;
      totalB += j.damageB + j.hitsB;
    });

    match.scoreA = totalA;
    match.scoreB = totalB;
    if (totalA === totalB) {
      match.winner = null;
    } else {
      match.winner = totalA > totalB ? match.robotA : match.robotB;
    }
    match.finished = true;
    match.type = "normal";
  }

  if (match.robotA) updateRobotScore(match.robotA.id, match.scoreA);
  if (match.robotB) updateRobotScore(match.robotB.id, match.scoreB);

  state.winner = match.winner;

  const allGroupsFinished = state.matches
    .filter((m) => m.phase === "groups")
    .every((m) => m.finished);

  if (allGroupsFinished) {
    generateGroupEliminations();
  }

  broadcastAndSave("UPDATE_STATE", { state });

  progressGroupEliminations();
  updateGroupChampions();
  checkAndGenerateGrandFinal();

  res.json({ ok: true, result: match });
});


app.delete("/robots/:id", (req, res) => {
  state.robots = state.robots.filter(r => r.id !== req.params.id);
  state.matches = state.matches.filter(m => m.robotA?.id !== req.params.id && m.robotB?.id !== req.params.id);
  if (state.currentMatchId && !state.matches.find(m => m.id === state.currentMatchId)) setCurrentMatch(null);
  broadcastAndSave("UPDATE_STATE", { state });
  res.json({ ok: true });
});

app.put("/robots/:id", (req, res) => {
  const robot = state.robots.find((r) => r.id === req.params.id);
  if (!robot) return res.status(404).json({ error: "Robot not found" });

  const { name, team, image } = req.body;
  if (name) robot.name = name;
  if (team) robot.team = team;
  if (image !== undefined) robot.image = image;

  broadcastAndSave("UPDATE_STATE", { state });
  res.json({ ok: true, robot });
});


/* ------------------ WEBSOCKET ------------------ */
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MAIN":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 10;
          state.recoveryActive = false;
          state.recoveryPaused = false;

          startMainTimer(180);
          broadcastAndSave("UPDATE_STATE", { state });
          break;


        case "PAUSE_MAIN":
          if (mainTick) clearInterval(mainTick);
          state.mainStatus = "paused";
          broadcastAndSave("UPDATE_STATE", { state });
          break;

        case "RESUME_MAIN":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 10;
          state.recoveryActive = false;
          state.recoveryPaused = false;

          if (state.mainTimer > 0) {
            startMainTimer(state.mainTimer);
          }
          break;

        case "RESET_MAIN":
          if (mainTick) clearInterval(mainTick);
          state.mainTimer = 180;
          state.mainStatus = "idle";
          broadcastAndSave("UPDATE_STATE", { state });
          break;

        case "START_RECOVERY":
          startRecoveryTimer(payload?.seconds ?? 10);
          break;

        case "PAUSE_RECOVERY":
          state.recoveryPaused = true;
          broadcastAndSave("UPDATE_STATE", { state });
          break;

        case "RESUME_RECOVERY":
          if (state.recoveryTimer > 0) {
            state.recoveryPaused = false;
            startRecoveryTimer(state.recoveryTimer, true);
          }
          break;


        case "RESET_RECOVERY":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 10;
          state.recoveryActive = false;
          state.recoveryPaused = false;
          broadcastAndSave("UPDATE_STATE", { state });
          break;


        case "END_MATCH":
          endMatchNow();
          break;
      }
    } catch {}
  });
});

console.log("Servidor iniciando...");