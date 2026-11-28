export type StageMode = 'lobby' | 'nominees' | 'category' | 'closed' | 'winner' | 'summary';

export interface Nominee {
  id: string;
  name: string;
  subtitle: string;
  accentColor: string;
  photoUrl?: string;
}

export interface Category {
  id: string;
  title: string;
  description: string;
  order: number;
  isVotingOpen: boolean;
  isWinnerRevealed: boolean;
  nominees: Nominee[];
}

export interface NomineeWithVotes extends Nominee {
  votes: number | null;
  percentage: number | null;
}

export interface PublicCategoryState {
  id: string;
  title: string;
  description: string;
  order: number;
  isVotingOpen: boolean;
  isWinnerRevealed: boolean;
  totalVotes: number;
  nominees: NomineeWithVotes[];
}

export interface PublicCeremonyState {
  ceremonyTitle: string;
  ceremonySubtitle: string;
  stageMode: StageMode;
  activeCategoryId: string | null;
  revealedNomineeIndex: number;
  showLiveTalliesOnScreen: boolean;
  connectedVotersCount: number;
  registeredVotersCount: number;
  totalVotesCast: number;
  categories: PublicCategoryState[];
  updatedAt: number;
}

export interface VoterVoteMap {
  [categoryId: string]: string; // nomineeId
}

export interface VoteTimelinePoint {
  minuteLabel: string;
  timestamp: number;
  count: number;
}

export interface VoterSummary {
  voterId: string;
  voterName: string;
  votesCount: number;
  joinedAt: number;
  lastVotedAt: number | null;
}

export interface AdminCategoryState extends Category {
  totalVotes: number;
  nominees: Array<Nominee & { votes: number; percentage: number }>;
}

export interface AdminCeremonyState {
  ceremonyTitle: string;
  ceremonySubtitle: string;
  stageMode: StageMode;
  activeCategoryId: string | null;
  revealedNomineeIndex: number;
  showLiveTalliesOnScreen: boolean;
  connectedVotersCount: number;
  connectedScreensCount: number;
  registeredVotersCount: number;
  totalVotesCast: number;
  categories: AdminCategoryState[];
  voters: VoterSummary[];
  timeline: VoteTimelinePoint[];
  updatedAt: number;
}

export interface VoterSessionInfo {
  voterId: string;
  voterName: string;
  voterToken: string;
  myVotes: VoterVoteMap;
}
