export interface Robot {
  id: string;
  name: string;
  team?: string;
  image?: string;
  score?: number;
}

export type Phase = "groups" | "elimination" | "repechage"; // ADICIONADO "repechage"

export interface Tournament {
  id: string; 
  name: string; 
  description?: string; 
  date?: string; 
  image?: string; 
  status: "draft" | "active" | "finished";
  advancePerGroup: number;
  groupCount: number;
  participatingRobotIds?: string[]; 
  participatingRobots?: Robot[]; 
  repechageRobotIds?: string[];
  repechageAdvanceCount: number;
  repechageWinner?: Robot | null; 
  useRepechage: boolean;
}

export interface Match {
  id: string;
  tournamentId?: string; 
  phase: Phase;           
  round: number;          
  group?: string | null;  
  robotA: Robot | null;
  robotB: Robot | null;
  scoreA: number;
  scoreB: number;
  winner: Robot | null;
  finished: boolean;
  type: "normal" | "KO" | "WO"; 
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
  pts: number;    
  wins: number;   
  draws: number;  
  losses: number; 
  ko: number;     
  wo: number;     
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