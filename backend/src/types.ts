export interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
  score?: number;
}

export type Phase = "groups" | "elimination";

export interface Tournament { // NOVO
  id: string;
  name: string;
  status: "draft" | "active" | "finished";
  advancePerGroup: number;
  groupCount: number;
}

export interface Match {
  id: string;
  tournamentId?: string; // NOVO: ID do torneio
  phase: Phase;           // "groups" ou "elimination"
  round: number;          // Nº da rodada dentro da phase (1,2,3...)
  group?: string | null;  // "A","B","C"... quando phase="groups"
  robotA: Robot | null;
  robotB: Robot | null;
  scoreA: number;
  scoreB: number;
  winner: Robot | null;
  finished: boolean;
  type: "normal" | "KO" | "WO";  // normal, k.o ou w.o
}

export interface RankingItem {
  robotId: string;
  robotName: string;
  wins: number;
}

export type MainStatus = "idle" | "running" | "paused" | "finished";

export interface GroupTableItem {
  robotId: string;
  name: string;
  team?: string;
  pts: number;     // Pontos totais do juiz
  wins: number;    // Vitórias
  draws: number;   // Empates
  losses: number;  // Derrotas
  ko: number;      // Vitórias por KO
  wo: number;      // Vitórias por WO
}


export interface ArenaState {
  robots: Robot[];
  matches: Match[];

  currentMatchId: string | null;

  // timers
  mainTimer: number;
  mainStatus: MainStatus;
  recoveryTimer: number;
  recoveryPaused: boolean,
  recoveryActive: boolean;

  // winners
  winner: Robot | null;
  lastWinner: Robot | null;

  // rankings / tables
  ranking: RankingItem[];
  groupTables?: Record<string, GroupTableItem[]>;
  
  // NOVO: Controle de torneios
  tournamentId: string | null; 
  tournaments: Tournament[];
  advancePerGroup: number;
  groupCount: number;
}