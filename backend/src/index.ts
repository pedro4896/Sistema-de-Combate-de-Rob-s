import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
// Usamos 'import type' para tipos definidos localmente
import type { ArenaState, Robot, Match, GroupTableItem, Tournament } from "./types"; 
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import type { QueryResult } from "pg"; // Importa QueryResult explicitamente como tipo

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
  groupTables: {},
  // Novos campos para gerenciamento de torneios
  tournamentId: null, 
  tournaments: [],
  advancePerGroup: 2,
  groupCount: 2,
};

// Variável para armazenar o estado em memória e a conexão DB
let state: ArenaState = defaultState;
let dbClient: Client | null = null;


// ===============================================
// FUNÇÕES DE PERSISTÊNCIA (SEPARADAS POR TABELA)
// ===============================================

/**
 * Cria as tabelas robots, matches, tournaments e arena_config se elas não existirem.
 */
async function setupDatabase() {
  if (!dbClient) return;
  
  // Tabela 1: Robôs (Inalterada)
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS robots (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        team VARCHAR(255),
        image VARCHAR(255),
        score INT DEFAULT 0
    );
  `);

  // Tabela 4: Torneios (NOVA)
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'finished'
        advance_per_group INT DEFAULT 2,
        group_count INT DEFAULT 2
    );
  `);
  
  // Tabela 2: Configuração Global (timers, status, configs de torneio) - Atualizada
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS arena_config (
        id INT PRIMARY KEY,
        current_match_id VARCHAR(255),
        main_timer INT DEFAULT 0,
        main_status VARCHAR(50) DEFAULT 'idle',
        recovery_timer INT DEFAULT 0,
        recovery_active BOOLEAN DEFAULT FALSE,
        recovery_paused BOOLEAN DEFAULT FALSE,
        last_winner_id VARCHAR(255),
        advance_per_group INT DEFAULT 2,
        group_count INT DEFAULT 2,
        active_tournament_id VARCHAR(255) -- NOVO: Torneio ativo
    );
  `);
  
  // Tabela 3: Partidas - Atualizada com tournament_id
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS matches (
        id VARCHAR(255) PRIMARY KEY,
        tournament_id VARCHAR(255) NOT NULL, -- NOVO: Chave estrangeira
        phase VARCHAR(50) NOT NULL,
        round INT NOT NULL,
        group_label VARCHAR(50),
        robot_a_id VARCHAR(255),
        robot_b_id VARCHAR(255),
        score_a INT DEFAULT 0,
        score_b INT DEFAULT 0,
        winner_id VARCHAR(255),
        finished BOOLEAN DEFAULT FALSE,
        type VARCHAR(50) DEFAULT 'normal'
    );
  `);

  // Garante que a linha de configuração exista (Atualizada com active_tournament_id)
  const configRes = await dbClient.query("SELECT * FROM arena_config WHERE id = 1");
  if (configRes.rows.length === 0) {
    await dbClient.query(`
      INSERT INTO arena_config (id, main_status, advance_per_group, group_count) 
      VALUES (1, $1, $2, $3)
    `, [defaultState.mainStatus, 2, 2]);
  }
  
  // Limpeza de tabelas antigas para evitar conflitos (opcional, mas seguro)
  await dbClient.query(`DROP TABLE IF EXISTS arena_state;`);

  console.log("🛠️ Estrutura do banco de dados verificada/criada.");
}


/**
 * Salva apenas os dados de configuração/estado em tempo real (timers, status, torneio ativo)
 */
async function saveConfig() {
  if (!dbClient) return;
  try {
    const config = state as any;
    const sql = `
      UPDATE arena_config SET
        current_match_id = $1,
        main_timer = $2,
        main_status = $3,
        recovery_timer = $4,
        recovery_active = $5,
        recovery_paused = $6,
        last_winner_id = $7,
        advance_per_group = $8,
        group_count = $9,
        active_tournament_id = $10
      WHERE id = 1;
    `;
    await dbClient.query(sql, [
      config.currentMatchId,
      config.mainTimer,
      config.mainStatus,
      config.recoveryTimer,
      config.recoveryActive,
      config.recoveryPaused,
      config.lastWinner?.id,
      config.advancePerGroup || 2,
      config.groupCount || 2,
      config.tournamentId || null,
    ]);
  } catch (error) {
    console.error("❌ Erro ao salvar configuração no DB:", error);
  }
}

/**
 * Carrega todos os dados das tabelas e reconstrói o objeto ArenaState em memória.
 */
async function loadStateFromDB(): Promise<ArenaState> {
  if (!dbClient) return defaultState;

  try {
    const [robotsRes, tournamentsRes, configRes] = await Promise.all([
      dbClient.query("SELECT * FROM robots ORDER BY name"),
      dbClient.query("SELECT * FROM tournaments ORDER BY name"), // Carrega todos os torneios
      dbClient.query("SELECT * FROM arena_config WHERE id = 1"),
    ]);

    // Mapeia Robôs (Inalterado)
    const robots: Robot[] = robotsRes.rows.map(row => ({
      id: row.id,
      name: row.name,
      team: row.team,
      image: row.image,
      score: row.score || 0,
    }));
    const robotMap = Object.fromEntries(robots.map(r => [r.id, r]));
    
    const config = configRes.rows[0];
    if (!config) return defaultState;

    // Mapeia Torneios (Novo)
    const tournaments: Tournament[] = tournamentsRes.rows.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status as any,
        advancePerGroup: row.advance_per_group,
        groupCount: row.group_count,
    }));
    
    const activeTournamentId = config.active_tournament_id;

    let matches: Match[] = [];
    let currentTournament: Tournament | undefined;

    // Carrega apenas as partidas do torneio ativo
    if (activeTournamentId) {
        const matchesRes = await dbClient.query(
            "SELECT * FROM matches WHERE tournament_id = $1 ORDER BY round, group_label, id",
            [activeTournamentId]
        );
        matches = matchesRes.rows.map(row => ({
            id: row.id,
            tournamentId: row.tournament_id,
            phase: row.phase as any,
            round: row.round,
            group: row.group_label,
            robotA: row.robot_a_id ? robotMap[row.robot_a_id] : null,
            robotB: row.robot_b_id ? robotMap[row.robot_b_id] : null,
            scoreA: row.score_a,
            scoreB: row.score_b,
            winner: row.winner_id ? robotMap[row.winner_id] : null,
            finished: row.finished,
            type: row.type as any,
        }));
        
        currentTournament = tournaments.find(t => t.id === activeTournamentId);
    }

    const newState: ArenaState = {
      robots,
      matches,
      currentMatchId: config.current_match_id,
      mainTimer: config.main_timer,
      mainStatus: config.main_status as any,
      recoveryTimer: config.recovery_timer,
      recoveryActive: config.recovery_active,
      recoveryPaused: config.recovery_paused,
      winner: config.last_winner_id ? robotMap[config.last_winner_id] : null,
      lastWinner: config.last_winner_id ? robotMap[config.last_winner_id] : null,
      ranking: [],
      groupTables: {},
      // Propriedades do torneio ativo
      tournamentId: activeTournamentId,
      tournaments,
      advancePerGroup: currentTournament?.advancePerGroup || config.advance_per_group || 2,
      groupCount: currentTournament?.groupCount || config.group_count || 2,
    };

    if (newState.tournamentId) {
      newState.groupTables = computeGroupTables(robots, matches);
    }
    
    // Assegura que o currentMatchId está no torneio ativo
    if (newState.currentMatchId && !matches.some(m => m.id === newState.currentMatchId)) {
        newState.currentMatchId = matches.find(m => !m.finished)?.id ?? null;
    }

    return newState;
  } catch (error) {
    console.error("❌ Erro ao carregar estado do DB:", error);
    return defaultState;
  }
}

// Função de suporte que usa loadStateFromDB
async function loadStateFromDBAndBroadcast() {
  state = await loadStateFromDB();
  broadcast("UPDATE_STATE", { state });
  console.log("🔄 Estado recarregado do banco de dados e transmitido.");
}

// Inicialização e Conexão ao DB
async function initDBAndServer() {
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
  
  dbClient = new Client(connectionConfig); 
  
  try {
    await dbClient.connect();
    console.log("✅ Conectado ao PostgreSQL");

    // 1. Configura as tabelas (cria se não existirem)
    await setupDatabase();
    
    // 2. Carrega o estado em memória (a nova lógica)
    state = await loadStateFromDB();
    
    // 3. Inicia o servidor
    server.listen(PORT, () =>
      console.log(`✅ Arena backend rodando @${PORT}`)
    );

  } catch (error) {
    console.error("❌ Falha ao conectar ao PostgreSQL:", error);
    process.exit(1); 
  }
}

// Chama a função de inicialização
initDBAndServer();

/* ------------------ UTILITÁRIOS & FUNÇÕES CORE ------------------ */

function broadcastAndSave(type: string, payload: any) {
  broadcast(type, payload);
  saveConfig(); // Salva APENAS o estado da arena/timers
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

/* ------------------ LÓGICA DE CHAVEAMENTO ------------------ */

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
                    tournamentId: state.tournamentId, // Adiciona o ID do torneio
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

function computeGroupTables(robots: Robot[] = state.robots, matches: Match[] = state.matches): Record<string, GroupTableItem[]> {
    const tables: Record<string, Record<string, GroupTableItem>> = {};
    const robotMap = Object.fromEntries(robots.map(r => [r.id, r]));
    // Filtra matches pelo torneio ativo
    const groupMatches = matches.filter((m) => m.phase === "groups" && m.tournamentId === state.tournamentId);

    const groups = Array.from(
        new Set(groupMatches.map((m) => m.group).filter(Boolean))
    );

    for (const g of groups) tables[g] = {};

    for (const m of groupMatches) {
        const g = m.group!;
        const A = m.robotA?.id;
        const B = m.robotB?.id;
        if (!A || !B || A === "bye" || B === "bye") continue;

        if (!tables[g][A]) tables[g][A] = makeItem(robotMap[A]!);
        if (!tables[g][B]) tables[g][B] = makeItem(robotMap[B]!);
        if (!m.finished) continue;

        if (m.scoreA > m.scoreB) {
            tables[g][A].pts += 3; tables[g][A].wins++; tables[g][B].losses++;
        } else if (m.scoreB > m.scoreA) {
            tables[g][B].pts += 3; tables[g][B].wins++; tables[g][A].losses++;
        } else {
            tables[g][A].pts++; tables[g][B].pts++;
            tables[g][A].draws++; tables[g][B].draws++;
        }

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
  state.groupTables = computeGroupTables();
  const advancePerGroup = (state as any).advancePerGroup || 2;
  const newMatches: Match[] = [];

  for (const g in state.groupTables) {
    const already = state.matches.some(
      (m) => m.phase === "elimination" && m.group === g && m.tournamentId === state.tournamentId
    );
    if (already) continue;

    const top = state.groupTables[g].slice(0, advancePerGroup);
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

      newMatches.push({
        id: uuidv4(),
        tournamentId: state.tournamentId, // Adiciona o ID do torneio
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
  
  if (newMatches.length > 0) {
    insertMatches(newMatches);
  }
  
  broadcastAndSave("UPDATE_STATE", { state });
}

function checkAndGenerateGrandFinal() {
  const groupLabels = Object.keys(state.groupTables || {});
  if (groupLabels.length === 0) return;

  const champions: Robot[] = [];

  for (const g of groupLabels) {
    const gMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g && m.tournamentId === state.tournamentId)
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
    (m) => m.phase === "elimination" && !m.group && m.tournamentId === state.tournamentId
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
      tournamentId: state.tournamentId, // Adiciona o ID do torneio
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
  
  if (finals.length > 0) {
    insertMatches(finals);
  }

  broadcastAndSave("UPDATE_STATE", { state });
}


function progressGroupEliminations() {
  const groupLabels = Object.keys(state.groupTables || {});
  const newMatches: Match[] = [];

  for (const g of groupLabels) {
    const groupMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g && m.tournamentId === state.tournamentId)
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

    for (let i = 0; i < shuffled.length; i += 2) {
      const A = shuffled[i];
      const B = shuffled[i + 1];
      const isBye = A.id === "bye" || B.id === "bye";
      const winner = isBye ? (A.id !== "bye" ? A : B) : null;

      newMatches.push({
        id: uuidv4(),
        tournamentId: state.tournamentId, // Adiciona o ID do torneio
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
  }

  if (newMatches.length > 0) {
    insertMatches(newMatches);
  }
  
  broadcastAndSave("UPDATE_STATE", { state });
}

function updateGroupChampions() {
  const groupLabels = Object.keys(state.groupTables || {});
  let changed = false;
  for (const g of groupLabels) {
    const gMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g && m.tournamentId === state.tournamentId)
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
      changed = true;
    }
  }

  if (changed) {
    broadcastAndSave("UPDATE_STATE", { state });
  }
}

function generateEliminationFromGroups() {
  state.groupTables = computeGroupTables();
  const tables = state.groupTables;
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
      tournamentId: state.tournamentId, // Adiciona o ID do torneio
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
        tournamentId: state.tournamentId, // Adiciona o ID do torneio
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

  insertMatches(elimMatches);
  
  const first = state.matches.find(m => !m.finished && m.tournamentId === state.tournamentId);
  setCurrentMatch(first?.id || null);
  broadcastAndSave("UPDATE_STATE", { state });
}

async function finalizeMatch(id: string, scoreA: number, scoreB: number, type: 'normal' | 'KO' | 'WO' = 'normal') {
  const m = state.matches.find(mm => mm.id === id);
  if (!m || !dbClient) return;

  let winnerId = null;
  if (m.robotA && m.robotB) {
    if (scoreA > scoreB) winnerId = m.robotA.id;
    else if (scoreB > scoreA) winnerId = m.robotB.id;
  }
  
  // 1. Atualiza a partida no DB (Adiciona tournament_id no WHERE)
  await dbClient.query(
    `UPDATE matches SET finished = TRUE, score_a = $1, score_b = $2, winner_id = $3, type = $4 WHERE id = $5 AND tournament_id = $6`,
    [scoreA, scoreB, winnerId, type, id, m.tournamentId]
  );
  
  // 2. Atualiza o score acumulado dos robôs no DB
  if (m.robotA && scoreA > 0) await updateRobotScoreInDB(m.robotA.id, scoreA);
  if (m.robotB && scoreB > 0) await updateRobotScoreInDB(m.robotB.id, scoreB);

  // 3. Recarrega o estado completo
  await loadStateFromDBAndBroadcast();

  // 4. Aplica lógica de avanço (usa lógica do estado recarregado)
  const currentMatchInState = state.matches.find(mm => mm.id === id);
  if (currentMatchInState) {
    const isGroupPhase = currentMatchInState.phase === "groups";

    if (isGroupPhase) {
      const allGroupsDone = state.matches.filter(x => x.phase === "groups").every(x => x.finished);
      if (allGroupsDone) generateEliminationFromGroups();
    } else {
      const round = currentMatchInState.round;
      // Filtra matches pelo torneio ativo
      const currentMatchesInRound = state.matches.filter(x => x.phase === "elimination" && x.round === round && x.group === currentMatchInState.group && x.tournamentId === currentMatchInState.tournamentId);
      
      if (currentMatchesInRound.every(x => x.finished)) {
          const winners = currentMatchesInRound.map(x => x.winner).filter(Boolean) as Robot[];
          const nextRoundMatches = state.matches.filter(x => x.phase === "elimination" && x.round === round + 1 && x.group === currentMatchInState.group && x.tournamentId === currentMatchInState.tournamentId);
          
          const queries = [];
          for (let i = 0; i < winners.length; i++) {
              const target = nextRoundMatches[Math.floor(i / 2)];
              if (!target) continue;
              
              if (i % 2 === 0) {
                  target.robotA = winners[i];
                  queries.push(dbClient.query(`UPDATE matches SET robot_a_id = $1 WHERE id = $2 AND tournament_id = $3`, [winners[i].id, target.id, target.tournamentId]));
              } else {
                  target.robotB = winners[i];
                  queries.push(dbClient.query(`UPDATE matches SET robot_b_id = $1 WHERE id = $2 AND tournament_id = $3`, [winners[i].id, target.id, target.tournamentId]));
              }
          }
          await Promise.all(queries);

          if (currentMatchInState.group) {
            progressGroupEliminations();
            updateGroupChampions();
            checkAndGenerateGrandFinal();
          }
      }
    }
  }

  // 5. Determina a próxima partida e atualiza a configuração
  const next = state.matches.find(x => !x.finished && x.tournamentId === state.tournamentId);
  if (next) setCurrentMatch(next.id);
  else {
    state.currentMatchId = null;
    state.mainStatus = "finished";
    broadcastAndSave("UPDATE_STATE", { state });
  }
}

/**
 * Insere múltiplas partidas no DB e recarrega o estado.
 */
async function insertMatches(matches: Match[]) {
  if (!dbClient || !state.tournamentId) return;

  const matchPromises = matches.map(m => {
    const isBye = m.robotA?.id === "bye" || m.robotB?.id === "bye";
    return dbClient?.query(
      `INSERT INTO matches (id, tournament_id, phase, round, group_label, robot_a_id, robot_b_id, score_a, score_b, winner_id, finished, type) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        m.id,
        state.tournamentId, // Usa o ID do torneio ativo
        m.phase,
        m.round,
        m.group,
        m.robotA?.id !== "bye" ? m.robotA?.id : null,
        m.robotB?.id !== "bye" ? m.robotB?.id : null,
        m.scoreA,
        m.scoreB,
        m.winner?.id || null,
        isBye || m.finished,
        m.type
      ]
    );
  });

  await Promise.all(matchPromises);
  await loadStateFromDBAndBroadcast();
}


/* ------------------ GERAÇÃO PRINCIPAL - Atualizada para gerenciar torneios ------------------ */

async function finalizeActiveTournament() {
  if (!dbClient || !state.tournamentId) return;

  await dbClient.query(
    `UPDATE tournaments SET status = $1 WHERE id = $2`,
    ['finished', state.tournamentId]
  );
  
  // Limpa a referência do torneio ativo, mas mantém as configs
  await dbClient.query(`UPDATE arena_config SET active_tournament_id = NULL WHERE id = 1`);
  state.tournamentId = null;
  state.currentMatchId = null;

  await loadStateFromDBAndBroadcast();
}

async function activateTournament(tournamentId: string) {
    if (!dbClient) return;
    
    const tournament = state.tournaments.find(t => t.id === tournamentId);
    if (!tournament) return;

    // 1. Se houver um torneio ativo, finalize-o
    if (state.tournamentId && state.tournamentId !== tournamentId) {
        await dbClient.query(
            `UPDATE tournaments SET status = $1 WHERE id = $2`,
            ['finished', state.tournamentId]
        );
    }
    
    // 2. Define o novo torneio como ativo e com status 'active'
    await dbClient.query(
        `UPDATE arena_config SET active_tournament_id = $1, advance_per_group = $2, group_count = $3 WHERE id = 1`,
        [tournamentId, tournament.advancePerGroup, tournament.groupCount]
    );
    await dbClient.query(
        `UPDATE tournaments SET status = $1 WHERE id = $2`,
        ['active', tournamentId]
    );

    // 3. Recarrega o estado completo e transmite
    await loadStateFromDBAndBroadcast();
    
    // 4. Define a primeira partida do novo torneio ativo
    const nextMatch = state.matches.find(m => m.tournamentId === tournamentId && !m.finished);
    setCurrentMatch(nextMatch?.id ?? null);
    
    // Garante que o estado final seja salvo e transmitido
    broadcastAndSave("UPDATE_STATE", { state });
}

async function generateTournament(name: string, groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2) {
  if (!dbClient) return;

  const newTournamentId = uuidv4();
  
  // 1. Finaliza o torneio ativo atual (se houver)
  if (state.tournamentId) {
    await finalizeActiveTournament();
  }

  // 2. Cria o novo torneio no DB
  await dbClient.query(
    `INSERT INTO tournaments (id, name, status, advance_per_group, group_count) VALUES ($1, $2, $3, $4, $5)`,
    [newTournamentId, name, 'active', advancePerGroup, groupCount]
  );
  
  // 3. Define o novo torneio como ativo
  await dbClient.query(
    `UPDATE arena_config SET active_tournament_id = $1, advance_per_group = $2, group_count = $3 WHERE id = 1`,
    [newTournamentId, advancePerGroup, groupCount]
  );

  // 4. Atualiza o estado em memória para o novo torneio ser o contexto para matches
  state.tournamentId = newTournamentId;
  (state as any).advancePerGroup = advancePerGroup;
  (state as any).groupCount = groupCount;
  
  const robots = [...state.robots];
  if (robots.length < 2) {
    state.matches = [];
    state.currentMatchId = null;
    broadcastAndSave("UPDATE_STATE", { state });
    return;
  }

  let groups = divideGroupsDynamic(robots, groupCount, robotsPerGroup);
  if (groups.length === 1) groups = [groups[0]];

  const groupMatches = generateGroupMatches(groups);

  // 5. Insere novas partidas para o novo torneio
  await insertMatches(groupMatches); // insertMatches usa state.tournamentId

  // 6. Define a primeira partida a ser jogada e atualiza o estado
  state.currentMatchId = state.matches.find(m => m.tournamentId === newTournamentId)?.id ?? null;
  state.lastWinner = null;
  
  broadcastAndSave("UPDATE_STATE", { state });
}

/* ------------------ INÍCIO DE LUTA ------------------ */
function startMatch(id: string) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;

  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  state.winner = null;

  broadcastAndSave("UPDATE_STATE", { state });
}


/**
 * Função auxiliar para atualizar o score acumulado do robô no DB
 */
async function updateRobotScoreInDB(robotId: string, scoreAtual: number) {
  const robot = state.robots.find((r) => r.id === robotId);
  if (robot) {
    const newScore = (robot.score || 0) + scoreAtual;
    await dbClient?.query(`UPDATE robots SET score = $1 WHERE id = $2`, [newScore, robotId]);
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

  // Filtra partidas pelo torneio ativo (ou por todas se não houver torneio ativo)
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
  await saveConfig();
  broadcast("UPDATE_STATE", { state });
  res.json({ ok: true, message: "Estado de configuração da arena salvo no banco de dados." });
});

app.post("/db/load", async (_req, res) => {
  await loadStateFromDBAndBroadcast();
  res.json({ ok: true, message: "Estado recarregado do banco de dados." });
});

// 🆕 Rotas de Torneios
app.get("/tournaments", async (_req, res) => {
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });
    const result = await dbClient.query("SELECT * FROM tournaments ORDER BY name");
    res.json({ tournaments: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        advancePerGroup: row.advance_per_group,
        groupCount: row.group_count,
    })) });
});

app.post("/tournaments/:id/activate", async (req, res) => {
    await activateTournament(req.params.id);
    res.json({ ok: true, message: `Torneio ${req.params.id} ativado.` });
});

app.post("/tournaments/:id/finish", async (req, res) => {
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });
    await dbClient.query(
        `UPDATE tournaments SET status = $1 WHERE id = $2`,
        ['finished', req.params.id]
    );
    if (state.tournamentId === req.params.id) {
        // Se o torneio ativo foi finalizado, desativa o ID e recarrega
        await dbClient.query(`UPDATE arena_config SET active_tournament_id = NULL WHERE id = 1`);
        state.tournamentId = null;
    }
    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, message: `Torneio ${req.params.id} finalizado.` });
});


// Rotas CRUD de Robôs e Partidas
app.post("/robots", async (req, res) => {
  const { name, team, image, score } = req.body;
  if (!dbClient || !name) return res.status(400).json({ error: "Nome do robô é obrigatório." });

  // Normaliza o campo team: trata undefined ou string vazia como null para a pesquisa
  const robotTeam = team || null;
  
  // 1. VERIFICAÇÃO DA RESTRIÇÃO: Nome Único por Equipe
  let checkQuery, checkValues;
  
  if (robotTeam) {
      // Caso 1: Equipe fornecida. Verifica se já existe robô com o mesmo nome E mesma equipe.
      checkQuery = `SELECT id FROM robots WHERE name = $1 AND team = $2`;
      checkValues = [name, robotTeam];
  } else {
      // Caso 2: Equipe NÃO fornecida. Verifica se já existe robô com o mesmo nome E equipe NULL/vazia.
      checkQuery = `SELECT id FROM robots WHERE name = $1 AND (team IS NULL OR team = '')`;
      checkValues = [name];
  }

  try {
        const existingRobot = await dbClient.query(checkQuery, checkValues);
        
        if (existingRobot.rows.length > 0) {
            const errorMessage = robotTeam
              ? `❌ Já existe um robô com o nome "${name}" na equipe "${robotTeam}".`
              : `❌ Já existe um robô sem equipe com o nome "${name}".`;
              console.log(errorMessage);

            // ✅ O backend está enviando o status 409 e a mensagem de erro.
            return res.status(409).json({ error: errorMessage }); 
        }
    } catch (error) {
        console.error("❌ Erro ao verificar robô no DB:", error);
        return res.status(500).json({ error: "Erro interno ao verificar o robô." });
    }

  // 2. CRIAÇÃO DO NOVO ROBÔ (Se a verificação passar)
  const newRobotData: Robot = {
    id: uuidv4(),
    name,
    team: robotTeam,
    image: image || null,
    score: score || 0
  };

  console.log("Inserting new robot:", newRobotData);

  // Insere na tabela 'robots'
  try {
      await dbClient.query(
          `INSERT INTO robots (id, name, team, image, score) VALUES ($1, $2, $3, $4, $5)`,
          [newRobotData.id, newRobotData.name, newRobotData.team, newRobotData.image, newRobotData.score]
      );
  } catch (error) {
      console.error("❌ Erro ao inserir robô no DB:", error);
      return res.status(500).json({ error: "Erro interno ao cadastrar o robô." });
  }
  
  // 3. ATUALIZA ESTADO E RETORNA
  await loadStateFromDBAndBroadcast(); 
  res.json(newRobotData);
});

app.post("/matches/generate", (req, res) => {
  let { groupCount = 2, robotsPerGroup = 4, advancePerGroup = 2 } = req.body || {};
  const total = state.robots.length;
  groupCount = Math.max(1, Math.min(groupCount, total));
  robotsPerGroup = Math.max(2, robotsPerGroup);
  advancePerGroup = Math.max(1, advancePerGroup);
  generateTournament("Torneio Gerado", groupCount, robotsPerGroup, advancePerGroup);
  res.json({ ok: true });
});

// Rota para inserir partidas de eliminação - Atualizada para usar o ID do torneio ativo
app.post("/matches/elimination", (req, res) => {
  const { matches } = req.body;
  state.matches.push(...matches);
  broadcast("UPDATE_STATE", { state });
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
  
  if (dbClient) {
    // 1. Limpa os dados das tabelas de dados
    await dbClient.query("DELETE FROM matches"); 
    await dbClient.query("DELETE FROM robots"); 
    await dbClient.query("DELETE FROM tournaments"); // NOVO: Limpa torneios
    // 2. Reseta a configuração da arena (incluindo active_tournament_id)
    await dbClient.query(`
      UPDATE arena_config SET 
        current_match_id = NULL,
        main_timer = $1,
        main_status = $2,
        recovery_timer = $3,
        recovery_active = $4,
        recovery_paused = $5,
        last_winner_id = NULL,
        advance_per_group = 2,
        group_count = 2,
        active_tournament_id = NULL -- NOVO: Reseta o torneio ativo
      WHERE id = 1
    `, [
      defaultState.mainTimer,
      defaultState.mainStatus,
      defaultState.recoveryTimer,
      defaultState.recoveryActive,
      defaultState.recoveryPaused
    ]);
  }

  await loadStateFromDBAndBroadcast(); 
  res.json({ ok: true });
});

app.post("/matches/:id/judges", async (req, res) => {
  if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });
  
  const match = state.matches.find((m) => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: "Match not found" });

  const { judges, decision, winnerId } = req.body;
  let totalA = 0, totalB = 0;
  let finalWinnerId = null;
  let finalType: 'normal' | 'KO' | 'WO' = 'normal';

  if (decision === "KO" || decision === "WO") {
    totalA = winnerId === match.robotA?.id ? 33 : 0;
    totalB = winnerId === match.robotB?.id ? 33 : 0;
    finalWinnerId = winnerId;
    finalType = decision as 'KO' | 'WO';
  } else {
    judges.forEach((j: any) => {
      totalA += j.damageA + j.hitsA;
      totalB += j.damageB + j.hitsB;
    });

    if (totalA !== totalB) {
      finalWinnerId = totalA > totalB ? match.robotA?.id : match.robotB?.id;
    }
  }

  // 1. Atualiza o score acumulado dos robôs no DB
  if (match.robotA && totalA > 0) await updateRobotScoreInDB(match.robotA.id, totalA);
  if (match.robotB && totalB > 0) await updateRobotScoreInDB(match.robotB.id, totalB);

  // 2. Finaliza a partida no DB (Atualizado com tournament_id)
  await dbClient.query(
    `UPDATE matches SET finished = TRUE, score_a = $1, score_b = $2, winner_id = $3, type = $4 WHERE id = $5 AND tournament_id = $6`,
    [totalA, totalB, finalWinnerId, finalType, match.id, match.tournamentId]
  );
  
  // 3. Recarrega o estado completo e aplica lógica de avanço
  await loadStateFromDBAndBroadcast();
  
  const allGroupsFinished = state.matches
    .filter((m) => m.phase === "groups" && m.tournamentId === state.tournamentId)
    .every((m) => m.finished);

  if (allGroupsFinished) {
    generateEliminationFromGroups();
  }

  progressGroupEliminations();
  updateGroupChampions();
  checkAndGenerateGrandFinal();

  res.json({ ok: true, result: state.matches.find((m) => m.id === req.params.id) });
});


app.delete("/robots/:id", async (req, res) => {
  if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

  const robotId = req.params.id;

  // 1. Remove o robô
  await dbClient.query(`DELETE FROM robots WHERE id = $1`, [robotId]);

  // 2. Recarrega o estado e ajusta partidas
  await loadStateFromDBAndBroadcast();
  
  if (state.currentMatchId && !state.matches.find(m => m.id === state.currentMatchId)) setCurrentMatch(null);
  
  // Atualiza as referências de robô nas partidas pendentes do torneio ativo
  await dbClient.query(`UPDATE matches SET robot_a_id = NULL WHERE robot_a_id = $1 AND finished = FALSE AND tournament_id = $2`, [robotId, state.tournamentId]);
  await dbClient.query(`UPDATE matches SET robot_b_id = NULL WHERE robot_b_id = $1 AND finished = FALSE AND tournament_id = $2`, [robotId, state.tournamentId]);
  await loadStateFromDBAndBroadcast(); // Recarrega novamente após limpar referências nas matches

  res.json({ ok: true });
});

app.put("/robots/:id", async (req, res) => {
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

    const robotId = req.params.id;
    const { name, team, image } = req.body;

    // Busca o robô atual no estado (necessário para fallback e validação)
    const currentRobot = state.robots.find(r => r.id === robotId);
    if (!currentRobot) return res.status(404).json({ error: "Robot not found" });

    // Determina o nome e a equipe a serem verificados/salvos
    const newName = name !== undefined ? name : currentRobot.name;
    // Normaliza team: string vazia ou undefined (se não estiver no body) deve ser tratada.
    const newTeam = team !== undefined ? (team || null) : currentRobot.team;

    // 1. VERIFICAÇÃO DA RESTRIÇÃO (Duplicação), EXCLUINDO o robô atual
    let checkQuery, checkValues;
    
    if (newTeam) {
        // Caso 1: Equipe fornecida. Verifica se JÁ EXISTE OUTRO robô com o mesmo nome E mesma equipe.
        checkQuery = `SELECT id FROM robots WHERE name = $1 AND team = $2 AND id != $3`;
        checkValues = [newName, newTeam, robotId];
    } else {
        // Caso 2: Equipe NÃO fornecida (ou nula). Verifica se JÁ EXISTE OUTRO robô com o mesmo nome E equipe NULL/vazia.
        checkQuery = `SELECT id FROM robots WHERE name = $1 AND (team IS NULL OR team = '') AND id != $2`;
        checkValues = [newName, robotId];
    }

    try {
        const existingRobot = await dbClient.query(checkQuery, checkValues);
        
        if (existingRobot.rows.length > 0) {
            const errorMessage = newTeam
                ? `❌ Já existe um robô com o nome "${newName}" na equipe "${newTeam}".`
                : `❌ Já existe um robô sem equipe com o nome "${newName}".`;

            // Retorna 409 Conflict com a mensagem de erro
            return res.status(409).json({ error: errorMessage });
        }
    } catch (error) {
        console.error("❌ Erro ao verificar robô no DB durante PUT:", error);
        return res.status(500).json({ error: "Erro interno ao verificar o robô." });
    }
    
    // 2. CRIAÇÃO DA QUERY DE ATUALIZAÇÃO (Se a verificação passar)
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(newName);
    }
    if (team !== undefined) {
      updates.push(`team = $${paramIndex++}`);
      values.push(newTeam);
    }
    if (image !== undefined) {
      updates.push(`image = $${paramIndex++}`);
      values.push(image || null);
    }
    
    // Ignorando score do body, pois o frontend não envia, mas se enviasse, deveria ser tratado.
    
    if (updates.length > 0) {
      values.push(robotId); 
      const sql = `UPDATE robots SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      await dbClient.query(sql, values);
    }

    // 3. ATUALIZA ESTADO E RETORNA
    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, robot: state.robots.find(r => r.id === robotId) });
});

/* ------------------ WEBSOCKET (Inalterado, usa broadcastAndSave) ------------------ */

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