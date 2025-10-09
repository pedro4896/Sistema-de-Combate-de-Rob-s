export interface Robot {
  id: string;
  name: string;
  image?: string;
}

export interface Match {
  id: string;
  round: number;
  robotA: Robot | null;
  robotB: Robot | null;
  scoreA: number;
  scoreB: number;
  winner: string | null; // robot id
  finished: boolean;
}

export interface RankingItem {
  robotId: string;
  robotName: string;
  wins: number;
}

export type ArenaStatus = "idle" | "ready" | "running" | "paused" | "recovery" | "finished";

export interface ArenaState {
  robots: Robot[];
  matches: Match[];
  currentMatchId: string | null;
  timer: number;           // main timer (sec)
  recoveryTimer: number;   // secondary 10s
  status: ArenaStatus;
  winner: string | null;   // robot id
  ranking: RankingItem[];
}
