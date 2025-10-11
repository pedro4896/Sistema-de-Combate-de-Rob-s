export interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
  score?: number;
}

export type Phase = "groups" | "elimination";

export interface Match {
  id: string;
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
  recoveryActive: boolean;

  // winners
  winner: Robot | null;
  lastWinner: Robot | null;

  // rankings / tables
  ranking: RankingItem[];
  groupTables?: Record<string, GroupTableItem[]>;
}
