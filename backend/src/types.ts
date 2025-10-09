export interface Robot {
  id: string;
  name: string;
  team: string;       // 🆕 nome da equipe
  image?: string;
}

export type RoundName = "quarter" | "semi" | "final";

export interface Match {
  id: string;
  round: RoundName;
  robotA: Robot | null;
  robotB: Robot | null;
  scoreA: number;
  scoreB: number;
  winner: Robot | null;
  finished: boolean;
}

export interface RankingItem {
  robotId: string;
  robotName: string;
  wins: number;
}

export type MainStatus = "idle" | "running" | "paused" | "finished";

export interface ArenaState {
  robots: Robot[];
  matches: Match[];
  currentRound: RoundName | null;
  currentMatchId: string | null;
  mainTimer: number;
  mainStatus: MainStatus;
  recoveryTimer: number;
  recoveryActive: boolean;
  winner: Robot | null;
  ranking: RankingItem[];
}
