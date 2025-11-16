import express from "express";
import cors from "cors";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
// Usamos 'import type' para tipos definidos localmente (para evitar ReferenceError no runtime)
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
        image TEXT,
        score INT DEFAULT 0
    );
  `);

  // Tabela 4: Torneios (ATUALIZADA)
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        date VARCHAR(255),
        image VARCHAR(255),
        status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'finished'
        advance_per_group INT DEFAULT 2,
        group_count INT DEFAULT 2,
        participating_robot_ids JSONB DEFAULT '[]'
    );
  `);

  // CORREÇÃO: Adiciona colunas se elas não existirem (para usuários com DBs antigos)
  await dbClient.query(`
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS description TEXT;
  `);
  await dbClient.query(`
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS date VARCHAR(255);
  `);
  await dbClient.query(`
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS image VARCHAR(255);
  `);
  await dbClient.query(`
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS participating_robot_ids JSONB DEFAULT '[]';
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

    // Mapeia Torneios (ATUALIZADO)
    const tournaments: Tournament[] = tournamentsRes.rows.map(row => {
      // Garante que participating_robot_ids seja um array
      let participatingRobotIds: string[] = [];
      try {
        participatingRobotIds = row.participating_robot_ids && Array.isArray(row.participating_robot_ids) 
          ? row.participating_robot_ids
          : JSON.parse(row.participating_robot_ids || '[]');
      } catch {
        participatingRobotIds = [];
      }
      

      const participatingRobots = participatingRobotIds
          .map((id: string) => robotMap[id])
          .filter(Boolean) as Robot[];

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        date: row.date,
        image: row.image,
        status: row.status as any,
        advancePerGroup: row.advance_per_group,
        groupCount: row.group_count,
        participatingRobotIds,
        participatingRobots,
      };
    });
    
    const activeTournamentId = config.active_tournament_id;

    let matches: Match[] = [];
    let currentTournament: Tournament | undefined;

    // Carrega apenas as partidas do torneio ativo (para o estado global)
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
      matches, // Contém apenas matches do torneio ativo
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
      // Calcula groupTables apenas para o torneio ativo (para o estado global)
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
  saveConfigAndBroadcast("UPDATE_STATE", { state });
  console.log("🔄 Estado recarregado do banco de dados e transmitido.");
}

// Inicialização e Conexão ao DB
async function initDBAndServer() {
  const POSTGRES_HOST = process.env.POSTGRES_HOST || "localhost"; 
  const POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5432); 
  const POSTGRES_USER = process.env.POSTGRES_USER || "postgres"; 
  const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "root";
  const POSTGRES_DB = process.env.POSTGRES_DB || "roboClash";

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

// Função para apenas transmitir (usada para o tick do timer - mais performática)
function broadcastOnly(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients)
    if (c.readyState === WebSocket.OPEN) c.send(msg);
}

// Função para salvar no DB e transmitir (usada para mudanças críticas de estado)
function saveConfigAndBroadcast(type: string, payload: any) {
  broadcastOnly(type, payload);
  saveConfig(); // Chamada para salvar no DB (assíncrona)
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  saveConfigAndBroadcast("UPDATE_STATE", { state });
}

function startMainTimer(seconds = 180) {
  stopAllTimers();
  state.mainTimer = seconds;
  state.mainStatus = "running";
  
  // 1. Envia comando LED para Luta Iniciada (BRANCO)
  broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_RUNNING" }); 
  
  // 2. Salva o estado crítico no DB apenas UMA VEZ ao iniciar
  saveConfigAndBroadcast("UPDATE_STATE", { state });
  
  // Apenas transmite o tick no intervalo (muito mais leve!)
  mainTick = setInterval(() => {
    if (state.mainStatus !== "running") return;
    state.mainTimer = Math.max(0, state.mainTimer - 1);
    
    // CORREÇÃO: Usa broadcastOnly para evitar I/O de DB a cada segundo
    broadcastOnly("UPDATE_STATE", { state }); 
    
    // Salva no DB a cada 10 segundos para persistência, se não for 0.
    if (state.mainTimer > 0 && state.mainTimer % 10 === 0) saveConfig();

    if (state.mainTimer === 0) endMatchNow();
  }, 1000);
}

// backend/src/index.ts - Modifique startRecoveryTimer (Aprox. linha 391)
function startRecoveryTimer(seconds = 10, resume = false) {
  if (!resume && state.mainStatus === "running") {
    state.mainStatus = "paused";
    if (mainTick) clearInterval(mainTick);
  }

  if (recoveryTick) clearInterval(recoveryTick);
  state.recoveryActive = true;
  state.recoveryPaused = false;
  state.recoveryTimer = seconds;
  
  // Envia comando LED para Pausa/Recuperação (VERMELHO)
  broadcastOnly("LED_COMMAND", { command: "STATE_RECOVERY_ACTIVE" }); 
  
  // Salva o estado crítico no DB ao iniciar o recovery
  saveConfigAndBroadcast("UPDATE_STATE", { state });

  recoveryTick = setInterval(() => {
    if (state.recoveryPaused) return;

    state.recoveryTimer = Math.max(0, state.recoveryTimer - 1);
    broadcastOnly("UPDATE_STATE", { state }); // Usa broadcastOnly no tick

    if (state.recoveryTimer === 0) {
      clearInterval(recoveryTick!);
      state.recoveryActive = false; // Corrigido: deve ser false ao terminar o timer
      state.recoveryPaused = false;
      saveConfigAndBroadcast("UPDATE_STATE", { state }); 

      if (state.mainTimer > 0) startMainTimer(state.mainTimer);
      else endMatchNow();
    }
  }, 1000);
}

// backend/src/index.ts - Modifique endMatchNow (Aprox. linha 411)
function endMatchNow() {
  stopAllTimers();
  state.mainStatus = "finished";
  state.recoveryActive = false;
  
  // Transmite fim da luta (VERMELHO) - caso o cronômetro chegue a zero
  broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_ENDED" });
  
  saveConfigAndBroadcast("UPDATE_STATE", { state }); 
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

// CORREÇÃO: Função startMatch re-inserida
function startMatch(id: string) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;

  state.currentMatchId = id;
  resetTimers();
  state.mainStatus = "idle";
  state.winner = null;
  broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_RUNNING" }); 
  saveConfigAndBroadcast("UPDATE_STATE", { state });
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

// CORREÇÃO ESSENCIAL: Permite computar tabelas para QUALQUER lista de matches
function computeGroupTables(robots: Robot[] = state.robots, matches: Match[] = state.matches): Record<string, GroupTableItem[]> {
    const tables: Record<string, Record<string, GroupTableItem>> = {};
    const robotMap = Object.fromEntries(robots.map(r => [r.id, r]));
    
    // Filtra apenas matches de grupo
    const groupMatches = matches.filter((m) => m.phase === "groups");

    // 1. Inicializa a tabela para cada robô participante nos grupos
    for (const m of groupMatches) {
        const g = m.group!;
        if (!tables[g]) tables[g] = {};
        
        const A = m.robotA?.id;
        const B = m.robotB?.id;

        if (A && A !== "bye" && !tables[g][A]) tables[g][A] = makeItem(robotMap[A]!);
        if (B && B !== "bye" && !tables[g][B]) tables[g][B] = makeItem(robotMap[B]!);
    }


    // 2. Processa os resultados
    for (const m of groupMatches) {
        const g = m.group!;
        const A = m.robotA?.id;
        const B = m.robotB?.id;
        if (!A || !B || A === "bye" || B === "bye" || !m.finished) continue;

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
  
  saveConfigAndBroadcast("UPDATE_STATE", { state });
}

function checkAndGenerateGrandFinal(): boolean {
  const groupLabels = Object.keys(state.groupTables || {});
  if (groupLabels.length === 0) return false;

  const champions: Robot[] = [];

  // 1. Coleta os campeões de cada grupo (se a eliminação interna estiver completa)
  for (const g of groupLabels) {
    const gMatches = state.matches
      .filter((m) => m.phase === "elimination" && m.group === g && m.tournamentId === state.tournamentId)
      .sort((a, b) => a.round - b.round);

    // Se a eliminação de algum grupo ainda não gerou partidas ou não terminou, retorna.
    if (gMatches.length === 0) return false;

    const rounds = [...new Set(gMatches.map((m) => m.round))].sort((a, b) => a - b);
    const lastRound = rounds[rounds.length - 1];
    const lastRoundMatches = gMatches.filter((m) => m.round === lastRound);

    const allFinished = lastRoundMatches.every((m) => m.finished);
    if (!allFinished) return false;

    const winners = lastRoundMatches.filter((m) => m.winner).map((m) => m.winner).filter(Boolean) as Robot[];
    if (winners.length === 1) champions.push(winners[0]);
    else return false; 
  }

  // 2. Verifica se a Fase Final (group: null) já foi gerada (checa se o Round 1 existe)
  const alreadyExists = state.matches.some(
    (m) => m.phase === "elimination" && m.group === null && m.round === 1 && m.tournamentId === state.tournamentId
  );
  if (alreadyExists) return false;

  if (champions.length < 2) return false;

  const BYE = { id: "bye", name: "BYE", team: "", image: "" } as Robot;
  const participants = [...champions].sort(() => Math.random() - 0.5); 

  // Adiciona BYE se o número for ímpar
  if (participants.length % 2 !== 0) participants.push(BYE);

  const initialRoundMatches: Match[] = [];
  
  // 3. Gerar os jogos da primeira rodada (Round 1) - Preenchidos com campeões
  for (let i = 0; i < participants.length; i += 2) {
    const A = participants[i];
    const B = participants[i + 1];
    const isBye = A.id === "bye" || B.id === "bye";
    const winner = isBye ? (A.id !== "bye" ? A : B) : null;

    initialRoundMatches.push({
      id: uuidv4(),
      tournamentId: state.tournamentId,
      phase: "elimination",
      round: 1,
      group: null, // <-- FASE FINAL GERAL (group: null)
      robotA: A.id !== "bye" ? A : null,
      robotB: B.id !== "bye" ? B : null,
      scoreA: isBye && winner?.id === A.id ? 33 : 0,
      scoreB: isBye && winner?.id === B.id ? 33 : 0,
      winner,
      finished: !!isBye,
      type: isBye ? "WO" : "normal",
    } as Match);
  }

  // 4. Gerar os jogos vazios para as rodadas seguintes (estrutura completa: semi, final)
  let currentMatchesInRound = initialRoundMatches.length;
  let currentRound = 1;
  
  while (currentMatchesInRound > 1) {
    const nextRoundMatchesCount = Math.ceil(currentMatchesInRound / 2);
    for (let i = 0; i < nextRoundMatchesCount; i++) {
      initialRoundMatches.push({
        id: uuidv4(),
        tournamentId: state.tournamentId,
        phase: "elimination",
        round: currentRound + 1,
        group: null, // <-- FASE FINAL GERAL (group: null)
        robotA: null,
        robotB: null,
        scoreA: 0,
        scoreB: 0,
        winner: null,
        finished: false,
        type: "normal",
      } as Match);
    }
    currentMatchesInRound = nextRoundMatchesCount;
    currentRound++;
  }

  if (initialRoundMatches.length > 0) {
    insertMatches(initialRoundMatches);
    return true; 
  }

  saveConfigAndBroadcast("UPDATE_STATE", { state });
  return false; 
}

function progressGroupEliminations(): boolean {
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

    // Se é a final do grupo (winners.length <= 1), não há mais rounds a gerar aqui.
    if (winners.length <= 1) continue;

    const nextRound = lastRound + 1;
    
    // CORREÇÃO: Evita duplicação ao verificar se os jogos da próxima rodada já existem.
    const alreadyGenerated = groupMatches.some(m => m.round === nextRound);
    if (alreadyGenerated) continue; 

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
        tournamentId: state.tournamentId,
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
    // Atenção: insertMatches chama loadStateFromDBAndBroadcast()
    insertMatches(newMatches); 
    return true; // Retorna true se inseriu partidas
  }
  
  saveConfigAndBroadcast("UPDATE_STATE", { state });
  return false; // Retorna false se não inseriu partidas
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
    saveConfigAndBroadcast("UPDATE_STATE", { state });
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
  saveConfigAndBroadcast("UPDATE_STATE", { state });
}

async function finalizeMatch(id: string, scoreA: number, scoreB: number, type: 'normal' | 'KO' | 'WO' = 'normal') {
  if (!dbClient) return;
  
  // 1. Obtém o estado atual da partida
  const m = state.matches.find(mm => mm.id === id);
  if (!m || !m.tournamentId) return;

  let winnerId = null;
  if (m.robotA && m.robotB) {
    if (scoreA > scoreB) winnerId = m.robotA.id;
    else if (scoreB > scoreA) winnerId = m.robotB.id;
  }
  
  // 2. Atualiza a partida no DB
  await dbClient.query(
    `UPDATE matches SET finished = TRUE, score_a = $1, score_b = $2, winner_id = $3, type = $4 WHERE id = $5 AND tournament_id = $6`,
    [scoreA, scoreB, winnerId, type, id, m.tournamentId]
  );
  
  // 3. Atualiza o score acumulado dos robôs no DB
  if (m.robotA) await updateRobotScoreInDB(m.robotA.id, scoreA);
  if (m.robotB) await updateRobotScoreInDB(m.robotB.id, scoreB);

  // 4. Recarrega o estado completo e transmite
  await loadStateFromDBAndBroadcast();

  // OBTEM A PARTIDA ATUALIZADA DO NOVO ESTADO
  const currentMatchInState = state.matches.find(mm => mm.id === id);
  if (!currentMatchInState) return;

  // 5. LÓGICA DE GERAÇÃO/AVANÇO
  
  // A. Se a fase de grupos terminou, gera a eliminação interna
  if (currentMatchInState.phase === "groups") {
    const allGroupsDone = state.matches.filter(x => x.phase === "groups" && x.tournamentId === currentMatchInState.tournamentId).every(x => x.finished);
    if (allGroupsDone) {
        if (generateGroupEliminations()) return; // Se gerou, interrompe o fluxo.
    }
  } 
  
  // B. Se a partida finalizada é de eliminação (interna ou final)
  else if (currentMatchInState.phase === "elimination") {
        
        const round = currentMatchInState.round;
        const group = currentMatchInState.group; 

        // 1. Checa se a rodada inteira terminou (partidas no mesmo round e grupo/sem grupo)
        const matchesInCurrentRound = state.matches.filter(x => 
            x.phase === "elimination" && 
            x.round === round && 
            x.group === group && 
            x.tournamentId === currentMatchInState.tournamentId
        );
        
        if (matchesInCurrentRound.every(x => x.finished)) {
            const winners = matchesInCurrentRound.map(x => x.winner).filter(Boolean) as Robot[];
            const nextRound = round + 1;

            // 2. Tenta preencher a próxima rodada (se ela existe)
            const nextRoundMatches = state.matches.filter(x => 
                x.phase === "elimination" && 
                x.round === nextRound && 
                x.group === group && 
                x.tournamentId === currentMatchInState.tournamentId
            );
            
            if (nextRoundMatches.length > 0) {
                const queries = [];
                for (let i = 0; i < winners.length; i++) {
                    const target = nextRoundMatches[Math.floor(i / 2)];
                    if (!target) continue;
                    
                    const robotKey = i % 2 === 0 ? 'robot_a_id' : 'robot_b_id';
                    // Atualiza a próxima partida com o vencedor.
                    queries.push(dbClient.query(`UPDATE matches SET ${robotKey} = $1 WHERE id = $2 AND tournament_id = $3`, [winners[i].id, target.id, target.tournamentId]));
                }
                await Promise.all(queries);
                await loadStateFromDBAndBroadcast(); // Recarrega após preencher as próximas lutas
            }

            // 3. Lógicas de geração de novas rodadas vazias (só se for mata-mata interno)
            if (group !== null) {
                if (progressGroupEliminations()) return; // Se gerou (próxima rodada interna), interrompe.
                
                updateGroupChampions(); // Atualiza a flag de campeão do grupo
                
                if (checkAndGenerateGrandFinal()) return; // Se gerou a Fase Final, interrompe.
            } 
        }
  }

  // 6. ENFORÇA SELEÇÃO MANUAL: 
  // Limpa o currentMatchId e, se o torneio acabou, define o status como finished.
  const tournamentMatches = state.matches.filter(x => x.tournamentId === currentMatchInState.tournamentId);
  const allFinished = tournamentMatches.every(x => x.finished);

  if (allFinished) {
    state.currentMatchId = null;
    state.mainStatus = "finished";
  } else {
    // Garante que o ID da partida recém-finalizada não está mais definido como current.
    state.currentMatchId = null;
  }
  
  saveConfigAndBroadcast("UPDATE_STATE", { state });
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
        m.tournamentId, // Usa o ID do torneio passado
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
  
  // REMOVIDO: Bloco que definia a próxima luta automaticamente, garantindo o controle manual.
  // const first = state.matches.find(m => !m.finished && m.tournamentId === state.tournamentId);
  // setCurrentMatch(first?.id || null);
  // saveConfigAndBroadcast("UPDATE_STATE", { state });
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

// ROTA ATUALIZADA: Ativa torneio e gera matches se for DRAFT
async function activateTournament(tournamentId: string) {
    if (!dbClient) return { ok: false, error: "DB client not initialized" };
    
    const tournament = state.tournaments.find(t => t.id === tournamentId);
    if (!tournament) return { ok: false, error: "Torneio não encontrado." };

    // 1. Finaliza o torneio ativo atual (se houver)
    if (state.tournamentId && state.tournamentId !== tournamentId) {
        await dbClient.query(
            `UPDATE tournaments SET status = $1 WHERE id = $2`,
            ['finished', state.tournamentId]
        );
    }
    
    // 2. Se for DRAFT, gera os matches iniciais com base nos participantes
    if (tournament.status === 'draft') {
        const participatingRobots = tournament.participatingRobots || [];

        if (participatingRobots.length < 2) {
             return { ok: false, error: "O torneio precisa de no mínimo 2 robôs para gerar o chaveamento." };
        }
        
        // Limpa partidas antigas (caso tenha havido tentativas de geração)
        await dbClient.query("DELETE FROM matches WHERE tournament_id = $1", [tournamentId]);
        
        // Define as configurações no estado global
        (state as any).advancePerGroup = tournament.advancePerGroup;
        (state as any).groupCount = tournament.groupCount;
        state.tournamentId = tournamentId; // Define como ativo para o contexto de `generateGroupMatches`

        let groups = divideGroupsDynamic(participatingRobots, tournament.groupCount, 4); // 4 é um valor padrão aqui
        if (groups.length === 1) groups = [groups[0]];

        const groupMatches = generateGroupMatches(groups);
        // Note: insertMatches usa o state.tournamentId que acabamos de definir, passando o ID correto para o DB
        await insertMatches(groupMatches);
    }
    
    // 3. Define o novo torneio como ativo e com status 'active'
    await dbClient.query(
        `UPDATE arena_config SET active_tournament_id = $1, advance_per_group = $2, group_count = $3 WHERE id = 1`,
        [tournamentId, tournament.advancePerGroup, tournament.groupCount]
    );
    await dbClient.query(
        `UPDATE tournaments SET status = $1 WHERE id = $2`,
        ['active', tournamentId]
    );

    // 4. Recarrega o estado completo e transmite
    await loadStateFromDBAndBroadcast();
    
    // 5. currentMatchId é mantido como NULL após insertMatches
    
    // Garante que o estado final seja salvo e transmitido
    saveConfigAndBroadcast("UPDATE_STATE", { state });
    return { ok: true, message: `Torneio "${tournament.name}" ativado e chaveamento gerado.` };
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

// ROTA ATUALIZADA: Ativa torneio e gera matches se for DRAFT
async function activateTournament(tournamentId: string) {
    if (!dbClient) return { ok: false, error: "DB client not initialized" };
    
    const tournament = state.tournaments.find(t => t.id === tournamentId);
    if (!tournament) return { ok: false, error: "Torneio não encontrado." };

    // 1. Finaliza o torneio ativo atual (se houver)
    if (state.tournamentId && state.tournamentId !== tournamentId) {
        await dbClient.query(
            `UPDATE tournaments SET status = $1 WHERE id = $2`,
            ['finished', state.tournamentId]
        );
    }
    
    // 2. Se for DRAFT, gera os matches iniciais com base nos participantes
    if (tournament.status === 'draft') {
        const participatingRobots = tournament.participatingRobots || [];

        if (participatingRobots.length < 2) {
             return { ok: false, error: "O torneio precisa de no mínimo 2 robôs para gerar o chaveamento." };
        }
        
        // Limpa partidas antigas (caso tenha havido tentativas de geração)
        await dbClient.query("DELETE FROM matches WHERE tournament_id = $1", [tournamentId]);
        
        // Define as configurações no estado global
        (state as any).advancePerGroup = tournament.advancePerGroup;
        (state as any).groupCount = tournament.groupCount;
        state.tournamentId = tournamentId; // Define como ativo para o contexto de `generateGroupMatches`

        let groups = divideGroupsDynamic(participatingRobots, tournament.groupCount, 4); // 4 é um valor padrão aqui
        if (groups.length === 1) groups = [groups[0]];

        const groupMatches = generateGroupMatches(groups);
        // Note: insertMatches usa o state.tournamentId que acabamos de definir, passando o ID correto para o DB
        await insertMatches(groupMatches);
    }
    
    // 3. Define o novo torneio como ativo e com status 'active'
    await dbClient.query(
        `UPDATE arena_config SET active_tournament_id = $1, advance_per_group = $2, group_count = $3 WHERE id = 1`,
        [tournamentId, tournament.advancePerGroup, tournament.groupCount]
    );
    await dbClient.query(
        `UPDATE tournaments SET status = $1 WHERE id = $2`,
        ['active', tournamentId]
    );

    // 4. Recarrega o estado completo e transmite
    await loadStateFromDBAndBroadcast();
    
    // 5. Define a primeira partida do novo torneio ativo
    const nextMatch = state.matches.find(m => m.tournamentId === tournamentId && !m.finished);
    setCurrentMatch(nextMatch?.id ?? null);
    
    // Garante que o estado final seja salvo e transmitido
    saveConfigAndBroadcast("UPDATE_STATE", { state });
    return { ok: true, message: `Torneio "${tournament.name}" ativado e chaveamento gerado.` };
}

// NOVO UTILITÁRIO: Carrega dados completos (matches e tables) para qualquer torneio
async function loadTournamentData(tournamentId: string) {
    if (!dbClient || !tournamentId) return null;
    
    const tournament = state.tournaments.find(t => t.id === tournamentId);
    if (!tournament) return null;

    const robots = state.robots;
    const robotMap = Object.fromEntries(robots.map(r => [r.id, r]));

    // 1. Fetch matches for the specific tournament ID
    const matchesRes = await dbClient.query(
        "SELECT * FROM matches WHERE tournament_id = $1 ORDER BY round, group_label, id",
        [tournamentId]
    );

    const matches: Match[] = matchesRes.rows.map(row => ({
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
    
    // 2. Calculate group tables based on the fetched matches
    // Correção: Se não houver matches (torneio recém-gerado), a tabela ainda é gerada com 0 pontos.
    const groupTables = computeGroupTables(robots, matches.filter(m => m.phase === 'groups'));

    return { matches, groupTables, tournament };
}

/* ------------------ ENDPOINTS ------------------ */

// NOVO ENDPOINT: Rota para buscar dados de QUALQUER torneio (usado pelo Bracket.tsx)
app.get("/tournaments/:id/data", async (req, res) => {
    const tournamentId = req.params.id;
    const data = await loadTournamentData(tournamentId);
    if (!data) return res.status(404).json({ ok: false, error: "Tournament data not found." });
    
    // Inclui o currentMatchId global e o status do timer para que o frontend
    // possa exibir corretamente qual luta está ativa no momento.
    res.json({ 
        ok: true, 
        matches: data.matches,
        groupTables: data.groupTables,
        tournament: data.tournament,
        currentMatchId: state.currentMatchId,
        mainStatus: state.mainStatus,
        advancePerGroup: state.advancePerGroup,
        groupCount: state.groupCount,
        tournaments: state.tournaments, // Inclui a lista completa de torneios para o seletor
    });
});


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
  saveConfigAndBroadcast("UPDATE_STATE", { state });
  res.json({ ok: true, message: "Estado de configuração da arena salvo no banco de dados." });
});

app.post("/db/load", async (_req, res) => {
  await loadStateFromDBAndBroadcast();
  res.json({ ok: true, message: "Estado recarregado do banco de dados." });
});

// POST: Criar Torneio (Draft)
app.post("/tournaments", async (req, res) => {
    const { name, description, image, groupCount = 2, advancePerGroup = 2 } = req.body;
    if (!dbClient || !name) return res.status(400).json({ error: "Nome do torneio é obrigatório." });

    const newTournamentId = uuidv4();
    const currentDate = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
    
    try {
        await dbClient.query(
            `INSERT INTO tournaments (id, name, description, date, image, status, advance_per_group, group_count, participating_robot_ids) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [newTournamentId, name, description || null, currentDate || null, image || null, 'draft', advancePerGroup, groupCount, '[]']
        );
        await loadStateFromDBAndBroadcast();
        res.json({ ok: true, message: `Torneio "${name}" criado com sucesso (Draft).` });
    } catch (error) {
        console.error("❌ Erro ao criar torneio:", error);
        res.status(500).json({ error: "Erro interno ao cadastrar o torneio." });
    }
});

// PUT: Editar Detalhes do Torneio (Apenas Draft)
app.put("/tournaments/:id", async (req, res) => {
    const { name, description, image, groupCount, advancePerGroup } = req.body;
    const tournamentId = req.params.id;

    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

    const currentTour = state.tournaments.find(t => t.id === tournamentId);
    if (!currentTour) return res.status(404).json({ error: "Torneio não encontrado." });
    if (currentTour.status !== 'draft') return res.status(403).json({ error: "Apenas torneios em status 'draft' podem ser editados." });

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
    }
    if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(description || null);
    }
    if (image !== undefined) {
        updates.push(`image = $${paramIndex++}`);
        values.push(image || null);
    }
    if (groupCount !== undefined) {
        updates.push(`advance_per_group = $${paramIndex++}`);
        values.push(Number(advancePerGroup));
    }
    if (advancePerGroup !== undefined) {
        updates.push(`group_count = $${paramIndex++}`);
        values.push(Number(groupCount));
    }

    if (updates.length > 0) {
        values.push(tournamentId); 
        const sql = `UPDATE tournaments SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
        await dbClient.query(sql, values);
    }

    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, message: "Torneio atualizado." });
});

// DELETE: Deletar Torneio (Apenas Draft ou Finished)
app.delete("/tournaments/:id", async (req, res) => {
    const tournamentId = req.params.id;
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

    const currentTour = state.tournaments.find(t => t.id === tournamentId);
    if (!currentTour) return res.status(404).json({ error: "Torneio não encontrado." });
    if (currentTour.status === 'active') return res.status(403).json({ error: "Não é possível deletar um torneio ATIVO. Finalize-o primeiro." });

    try {
        await dbClient.query("DELETE FROM matches WHERE tournament_id = $1", [tournamentId]);
        await dbClient.query("DELETE FROM tournaments WHERE id = $1", [tournamentId]);
        
        await loadStateFromDBAndBroadcast();
        res.json({ ok: true, message: `Torneio deletado com sucesso.` });
    } catch (error) {
        console.error("❌ Erro ao deletar torneio:", error);
        res.status(500).json({ error: "Erro interno ao deletar o torneio." });
    }
});

// POST: Adicionar/Remover Robôs (Apenas Draft)
app.post("/tournaments/:id/set-robots", async (req, res) => {
    const { robotIds } = req.body; // Array de IDs de robôs
    const tournamentId = req.params.id;
    
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });
    const currentTour = state.tournaments.find(t => t.id === tournamentId);
    if (!currentTour) return res.status(404).json({ error: "Torneio não encontrado." });
    if (currentTour.status !== 'draft') return res.status(403).json({ error: "Apenas torneios em status 'draft' podem ter participantes alterados." });
    
    if (!Array.isArray(robotIds)) return res.status(400).json({ error: "Lista de IDs de robôs inválida." });
    
    // Converte o array de IDs para string JSON para salvar no DB
    const robotIdsJson = JSON.stringify(robotIds);

    await dbClient.query(
        `UPDATE tournaments SET participating_robot_ids = $1 WHERE id = $2`,
        [robotIdsJson, tournamentId]
    );

    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, message: `Lista de participantes atualizada para ${robotIds.length} robôs.` });
});


// POST: Ativar Torneio (que também gera o chaveamento inicial)
app.post("/tournaments/:id/activate", async (req, res) => {
    const result = await activateTournament(req.params.id);
    if (result.ok) {
        res.json(result);
    } else {
        res.status(400).json(result);
    }
});

// POST: Finalizar Torneio
app.post("/tournaments/:id/finalize", async (req, res) => {
    const tournamentId = req.params.id;
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

    const currentTour = state.tournaments.find(t => t.id === tournamentId);
    if (!currentTour) return res.status(404).json({ error: "Torneio não encontrado." });
    
    const finalizeQuery = await dbClient.query(
        `UPDATE tournaments SET status = $1 WHERE id = $2 RETURNING *`,
        ['finished', tournamentId]
    );

    // Se o torneio finalizado for o ativo, desativa-o globalmente
    if (state.tournamentId === tournamentId) {
        await dbClient.query(`UPDATE arena_config SET active_tournament_id = NULL WHERE id = 1`);
        state.tournamentId = null;
    }

    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, message: `Torneio "${currentTour.name}" foi FINALIZADO.` });
});


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

          // Retorna 409 Conflict com a mensagem de erro para o frontend exibir o alerta
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
  // Esta rota agora é legacy. A nova lógica de geração está em /tournaments/:id/activate
  res.status(400).json({ ok: false, error: "Use a página de Torneios para criar e ativar torneios. O endpoint /matches/generate foi descontinuado." });
});


// Rota para inserir partidas de eliminação - Atualizada para usar o ID do torneio ativo
app.post("/matches/elimination", (req, res) => {
  const { matches } = req.body;
  state.matches.push(...matches);
  saveConfigAndBroadcast("UPDATE_STATE", { state });
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
  let finalType: 'normal' | 'KO' | 'WO' = 'normal';
  
  // 1. Lógica de Scoring (K.O./W.O. ou por Pontos)
  if (decision === "KO" || decision === "WO") {
    totalA = winnerId === match.robotA?.id ? 33 : 0;
    totalB = winnerId === match.robotB?.id ? 33 : 0;
    finalType = decision as 'KO' | 'WO';
  } else {
    judges.forEach((j: any) => {
      totalA += j.damageA + j.hitsA;
      totalB += j.damageB + j.hitsB;
    });
  }

  // 2. Chama a função centralizada. Esta função fará o update no DB, 
  // o reload do estado e a lógica de avanço do chaveamento, com segurança.
  await finalizeMatch(match.id, totalA, totalB, finalType);

  // 3. Retorna o estado atualizado (após finalizeMatch)
  res.json({ 
    ok: true, 
    result: state.matches.find((m) => m.id === req.params.id) 
  });
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

// CORREÇÃO FINAL: Implementação da verificação de duplicidade para edição (PUT)
app.put("/robots/:id", async (req, res) => {
    if (!dbClient) return res.status(500).json({ error: "DB client not initialized" });

    const robotId = req.params.id;
    const { name, team, image } = req.body;

    // Busca o robô atual no estado (necessário para fallback e validação)
    const currentRobot = state.robots.find(r => r.id === robotId);
    if (!currentRobot) return res.status(404).json({ error: "Robot not found" });

    // Determina o nome e a equipe a serem verificados/salvos
    const newName = name !== undefined ? name : currentRobot.name;
    // Normaliza team: string vazia ou null (se não estiver no body) deve ser tratada.
    const newTeam = team !== undefined ? (team.trim() || null) : currentRobot.team;
    
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
    
    
    if (updates.length > 0) {
      values.push(robotId); 
      const sql = `UPDATE robots SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      await dbClient.query(sql, values);
    }

    // 3. ATUALIZA ESTADO E RETORNA
    await loadStateFromDBAndBroadcast();
    res.json({ ok: true, robot: state.robots.find(r => r.id === robotId) });
});


/* ------------------ WEBSOCKET (Inalterado, usa saveConfigAndBroadcast) ------------------ */

wss.on("connection", (ws) => {
  // Envia o estado atual para o cliente que acabou de se conectar
  ws.send(JSON.stringify({ type: "UPDATE_STATE", payload: { state } }));
  
  // NOVO: Garante que o LED inicie no estado IDLE_NORMAL para o novo cliente
  if (state.mainStatus === "idle" && !state.recoveryActive) {
      ws.send(JSON.stringify({ type: "LED_COMMAND", payload: { command: "STATE_IDLE_NORMAL" } }));
  }


  ws.on("message", (raw) => {
    try {
      const { type, payload } = JSON.parse(String(raw));
      switch (type) {
        case "START_MAIN":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 0; // Se estiver em 10, reseta para 0 para não interferir
          state.recoveryActive = false;
          state.recoveryPaused = false;
          
          broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_RUNNING" });
          startMainTimer(180); // Esta função agora envia STATE_FIGHT_RUNNING e faz o save

          // NOTA: 'startMainTimer' não deve ter 'broadcastAndSave' aqui; a lógica está DENTRO dela.
          // Se você ainda precisa de uma confirmação, use apenas:
          // saveConfig(); 
          break;


        case "PAUSE_MAIN":
          if (mainTick) clearInterval(mainTick);
          state.mainStatus = "paused";
          
          // Envia comando LED para Pausa (VERMELHO)
          broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_PAUSED" });
          saveConfigAndBroadcast("UPDATE_STATE", { state });
          break;

        case "RESUME_MAIN":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 0;
          state.recoveryActive = false;
          state.recoveryPaused = false;
          broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_RUNNING" });
          
          if (state.mainTimer > 0) {
            startMainTimer(state.mainTimer); // Esta função agora envia STATE_FIGHT_RUNNING
          }
          // Se o timer for 0, startMainTimer chama endMatchNow
          break;


        case "RESET_MAIN":
          if (mainTick) clearInterval(mainTick);
          state.mainTimer = 180;
          state.mainStatus = "idle";
          
          // Volta ao estado IDLE NORMAL
          broadcastOnly("LED_COMMAND", { command: "STATE_IDLE_NORMAL" });
          saveConfigAndBroadcast("UPDATE_STATE", { state });
          break;


        case "START_RECOVERY":
          // startRecoveryTimer já envia STATE_RECOVERY_ACTIVE e faz o save
          broadcastOnly("LED_COMMAND", { command: "STATE_RECOVERY_ACTIVE" });
          startRecoveryTimer(payload?.seconds ?? 10);
          break;

        case "PAUSE_RECOVERY":
          state.recoveryPaused = true;
          broadcastOnly("LED_COMMAND", { command: "STATE_RECOVERY_ACTIVE" });
          saveConfigAndBroadcast("UPDATE_STATE", { state });
          break;

        case "RESUME_RECOVERY":
          if (state.recoveryTimer > 0) {
            state.recoveryPaused = false;
            broadcastOnly("LED_COMMAND", { command: "STATE_RECOVERY_ACTIVE" });
            startRecoveryTimer(state.recoveryTimer, true); 
          }
          break;


        case "RESET_RECOVERY":
          if (recoveryTick) clearInterval(recoveryTick);
          state.recoveryTimer = 0; // Corrigido: Para não ficar com '10' como default
          state.recoveryActive = false;
          state.recoveryPaused = false;
          
          // Volta ao estado IDLE NORMAL
          broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_RUNNING" });
          saveConfigAndBroadcast("UPDATE_STATE", { state });
          break;


        case "END_MATCH":
          broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_ENDED" });
          endMatchNow(); // Esta função agora envia STATE_FIGHT_ENDED
          break;
          const targetSide = payload?.side; // 'GREEN', 'BLUE', ou 'NORMAL'
          
          if (state.mainStatus === "running" || state.recoveryActive) {
            // Regra 1: Se a luta estiver rodando, PAUSA (VERMELHO)
            if (mainTick) clearInterval(mainTick);
            state.mainStatus = "paused";
            broadcastOnly("LED_COMMAND", { command: "STATE_FIGHT_PAUSED" });
            saveConfigAndBroadcast("UPDATE_STATE", { state }); // Sincroniza estado de pausa com o frontend
            
          } else {
            // Regra 2: Se estiver IDLE, alterna o lado
            if (targetSide === 'GREEN') {
                broadcastOnly("LED_COMMAND", { command: "STATE_IDLE_GREEN_OFF" });
            } else if (targetSide === 'BLUE') {
                broadcastOnly("LED_COMMAND", { command: "STATE_IDLE_BLUE_OFF" });
            } else {
                // Se o comando for NORMAL (ou reset), volta ao IDLE padrão.
                broadcastOnly("LED_COMMAND", { command: "STATE_IDLE_NORMAL" });
            }
            // Apenas envia a atualização para o frontend, não altera o timer principal.
            broadcastOnly("UPDATE_STATE", { state }); 
          }
          break;
      }
    } catch (e) {
        console.error("Erro no processamento da mensagem WebSocket:", e);
    }
  });
});

console.log("Servidor iniciando...");