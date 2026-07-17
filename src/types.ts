export const PROTOCOL_VERSION = 'aeonfront/1';
export const STANDARD_TURNS = 6;
export const DECK_SIZE = 12;
export const DEFAULT_FRONT_CAPACITY = 4;
export const MAX_EVENTS_PER_RESOLUTION = 256;
export const MAX_TRIGGER_DEPTH = 16;

export type PlayerId = string;
export type GamePhase = 'planning' | 'resolving' | 'ended';
export type AbilityTrigger =
  | 'deploy'
  | 'ongoing'
  | 'turn_start'
  | 'turn_end'
  | 'finale';

export interface AbilityDefinition {
  abilityId: string;
  trigger: AbilityTrigger;
  targetRule: string;
  nameZh: string;
  descriptionZh: string;
}

export interface CardDefinition {
  cardId: string;
  characterUid: string;
  characterId: string;
  slug: string;
  nameZh: string;
  nameEn?: string;
  cost: number;
  power: number;
  abilityId: string;
  abilityArgs?: Record<string, unknown>;
  abilityTextZh: string;
  abilityTextEn?: string;
  trigger: AbilityTrigger;
  targetRule: string;
  faction: string;
  era: string;
  region: string;
  profession: string;
  identity: string;
  rarity: string;
  description: string;
  sourceAbility: string;
  tags: string[];
  set: string;
  version: number;
  token?: boolean;
  imageKey?: string;
}

export interface FrontDefinition {
  frontId: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  effectId: string;
  effectArgs?: Record<string, unknown>;
  enabled: boolean;
  weight: number;
  tags: string[];
  strategyZh: string;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId;
  currentPower: number;
  frontId: string;
  revealed: boolean;
  silenced: boolean;
  deployedTurn: number;
  modifiers: Array<{ source: string; amount: number }>;
}

export interface DeploymentIntent {
  cardId: string;
  frontId: string;
  order: number;
}

export interface MoveIntent {
  instanceId: string;
  targetFrontId: string;
}

export interface TurnIntent {
  requestId: string;
  turn: number;
  deployments: DeploymentIntent[];
  moves?: MoveIntent[];
}

export interface PlayerState {
  playerId: PlayerId;
  name: string;
  deck: string[];
  hand: string[];
  fronts: Record<string, CardInstance[]>;
  graveyard: CardInstance[];
  energy: number;
  locked: boolean;
  intent?: TurnIntent;
  bannerUsed: boolean;
  withdrawn: boolean;
}

export interface FrontState {
  definition: FrontDefinition;
  revealed: boolean;
  revealedTurn?: number;
  blockedFor?: PlayerId;
}

export interface StakeState {
  current: 1 | 2 | 4 | 8;
  pending: 2 | 4 | 8 | null;
  pendingTurn: number | null;
  raisedBy: PlayerId[];
}

export interface GameWinner {
  winnerId: PlayerId | null;
  reason: 'fronts' | 'total_power' | 'draw' | 'withdrawal';
  stake: number;
  frontWinners: Record<string, PlayerId | null>;
  totals: Record<PlayerId, number>;
}

export interface GameEvent {
  sequence: number;
  type: string;
  turn: number;
  playerId?: PlayerId;
  public: boolean;
  payload: Record<string, unknown>;
}

export interface GameSetup {
  seed: number;
  cards: CardDefinition[];
  fronts: FrontDefinition[];
  players: Array<{ playerId: PlayerId; name: string; deck: string[] }>;
}

export interface GameState {
  protocolVersion: typeof PROTOCOL_VERSION;
  gameId: string;
  seed: number;
  rngState: number;
  turn: number;
  phase: GamePhase;
  sequence: number;
  nextInstanceId: number;
  initiativePlayerId: PlayerId;
  fronts: FrontState[];
  players: [PlayerState, PlayerState];
  stake: StakeState;
  winner: GameWinner | null;
  eventLog: GameEvent[];
  processedRequestIds: string[];
  cardCatalog: Record<string, CardDefinition>;
  setup: GameSetup;
}

export interface GameOptions extends GameSetup {
  gameId?: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

export interface AbilityContext {
  gameState: GameState;
  sourceCardId: string;
  sourceInstanceId: string;
  sourcePlayerId: string;
  sourceFrontId?: string;
  targetPlayerId?: string;
  targetFrontId?: string;
  targetCardIds?: string[];
  turn: number;
  eventQueue: GameEvent[];
  depth: number;
}

export interface PlayerView {
  protocolVersion: string;
  gameId: string;
  turn: number;
  phase: GamePhase;
  sequence: number;
  initiativePlayerId: PlayerId;
  fronts: Array<{
    definition: FrontDefinition;
    revealed: boolean;
    revealedTurn?: number;
    cards: Record<PlayerId, Array<Partial<CardInstance> & Pick<CardInstance, 'instanceId' | 'ownerId' | 'revealed'>>>;
    power: Record<PlayerId, number | null>;
  }>;
  players: Array<{
    playerId: PlayerId;
    name: string;
    hand?: string[];
    handCount: number;
    deckCount: number;
    graveyardCount: number;
    energy: number;
    locked: boolean;
    bannerUsed: boolean;
    withdrawn: boolean;
  }>;
  stake: StakeState;
  winner: GameWinner | null;
  events: GameEvent[];
}

export class RuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'RuleError';
  }
}
