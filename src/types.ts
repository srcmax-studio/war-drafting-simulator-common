export const PROTOCOL_VERSION = 'aeonfront/2';
export const CARD_SCHEMA_VERSION = 2;
export const DECK_SCHEMA_VERSION = 2;
export const STANDARD_TURNS = 6;
export const DECK_SIZE = 12;
export const DEFAULT_FRONT_CAPACITY = 4;
export const MAX_EVENTS_PER_RESOLUTION = 512;
export const MAX_TRIGGER_DEPTH = 16;
export const MAX_ABILITY_REPEATS = 8;

export type PlayerId = string;
export type GamePhase = 'planning' | 'resolving' | 'ended';

export type AbilityTrigger =
  | 'on_draw'
  | 'on_created'
  | 'before_play'
  | 'on_play'
  | 'on_reveal'
  | 'after_reveal'
  | 'on_deploy'
  | 'after_card_played_here'
  | 'after_ally_played'
  | 'after_enemy_played'
  | 'turn_start'
  | 'turn_end'
  | 'before_move'
  | 'after_move'
  | 'on_discard'
  | 'on_destroy'
  | 'after_ally_destroyed'
  | 'after_enemy_destroyed'
  | 'on_return_to_hand'
  | 'on_front_revealed'
  | 'on_front_won'
  | 'on_front_lost'
  | 'finale'
  | 'before_scoring'
  | 'ongoing'
  | 'deploy';

export type ComparisonOperator =
  | 'equals'
  | 'not_equals'
  | 'at_least'
  | 'at_most'
  | 'greater_than'
  | 'less_than'
  | 'includes'
  | 'not_includes';

export type AbilityConditionType =
  | 'turn'
  | 'front_card_count'
  | 'front_total_power'
  | 'is_leading'
  | 'is_trailing'
  | 'card_cost'
  | 'base_power'
  | 'current_power'
  | 'era'
  | 'region'
  | 'profession'
  | 'identity'
  | 'faction'
  | 'tag'
  | 'was_moved'
  | 'created_by_effect'
  | 'died_before'
  | 'first_trigger'
  | 'hand_count'
  | 'deck_count'
  | 'graveyard_count'
  | 'controlled_fronts'
  | 'has_initiative'
  | 'stake'
  | 'banner_raised'
  | 'deployments_this_game'
  | 'moves_this_game'
  | 'deaths_this_game'
  | 'discards_this_game'
  | 'cards_drawn_this_game'
  | 'deck_tag_count'
  | 'marker_count'
  | 'source_is_token';

export interface AbilityCondition {
  type: AbilityConditionType;
  operator?: ComparisonOperator;
  value?: string | number | boolean;
  values?: Array<string | number>;
  scope?: 'self' | 'owner' | 'opponent' | 'source_front' | 'all_fronts';
  tag?: string;
}

export type TargetSelectorType =
  | 'self'
  | 'source_front'
  | 'owner'
  | 'opponent'
  | 'same_front_allies'
  | 'same_front_enemies'
  | 'adjacent_front_allies'
  | 'adjacent_front_enemies'
  | 'all_allies'
  | 'all_enemies'
  | 'strongest_card'
  | 'weakest_card'
  | 'highest_cost_card'
  | 'lowest_cost_card'
  | 'random_legal_card'
  | 'owner_hand'
  | 'opponent_hand'
  | 'owner_deck_top'
  | 'owner_deck_random'
  | 'owner_graveyard'
  | 'owner_discard'
  | 'matching_tag'
  | 'matching_era'
  | 'matching_region'
  | 'unrevealed_cards'
  | 'moved_cards'
  | 'deployed_this_turn'
  | 'all_fronts';

export interface TargetFilter {
  field: 'cost' | 'base_power' | 'current_power' | 'era' | 'region' | 'profession' | 'identity' | 'faction' | 'tag' | 'revealed' | 'token';
  operator?: ComparisonOperator;
  value: string | number | boolean;
}

export interface TargetSelector {
  type: TargetSelectorType;
  count?: number;
  random?: boolean;
  includeSelf?: boolean;
  side?: 'owner' | 'opponent' | 'both';
  scope?: 'source_front' | 'adjacent_fronts' | 'all_fronts';
  filters?: TargetFilter[];
  tag?: string;
  era?: string;
  region?: string;
}

export type AtomicEffectType =
  | 'add_power'
  | 'reduce_power'
  | 'set_power'
  | 'swap_power'
  | 'copy_power'
  | 'temporary_power'
  | 'permanent_power'
  | 'add_cost'
  | 'reduce_cost'
  | 'set_cost'
  | 'draw_cards'
  | 'create_token'
  | 'copy_card'
  | 'transform_card'
  | 'discard_cards'
  | 'destroy_cards'
  | 'revive_card'
  | 'return_to_hand'
  | 'shuffle_into_deck'
  | 'move_card'
  | 'swap_positions'
  | 'randomize_position'
  | 'block_deploy'
  | 'block_move'
  | 'silence'
  | 'protect'
  | 'immune'
  | 'delay_reveal'
  | 'reveal_now'
  | 'repeat_ability'
  | 'remove_ongoing'
  | 'increase_capacity'
  | 'decrease_capacity'
  | 'gain_energy'
  | 'lose_energy'
  | 'store_energy'
  | 'consume_marker'
  | 'add_marker'
  | 'seize_initiative'
  | 'change_stake'
  | 'history_power'
  | 'other_front_power'
  | 'deck_composition_power'
  | 'set_status';

export interface EffectSpec {
  type: AtomicEffectType;
  amount?: number;
  value?: number | string | boolean;
  target?: TargetSelector;
  duration?: 'turn' | 'game' | number;
  marker?: string;
  status?: string;
  cardId?: string;
  tokenId?: string;
  destination?: 'left' | 'right' | 'adjacent' | 'weakest_front' | 'strongest_front' | 'random_front' | 'source_front' | 'hand';
  counter?: 'deployments' | 'moves' | 'deaths' | 'discards' | 'cardsDrawn';
  tag?: string;
  multiplier?: number;
  scaleBy?: 'target_count' | 'other_allies' | 'matching_tags' | 'distinct_eras' | 'distinct_regions' | 'marker_count';
  minimum?: number;
  maximum?: number;
}

export interface TriggerLimit {
  scope: 'once_per_turn' | 'once_per_game' | 'once_per_front' | 'first_only' | 'up_to';
  count?: number;
}

export interface CardAbilitySpec {
  abilityId: string;
  nameZh: string;
  textZh: string;
  trigger: AbilityTrigger;
  conditions?: AbilityCondition[];
  target: TargetSelector;
  effects: EffectSpec[];
  limit?: TriggerLimit;
  priority?: number;
}

export interface AbilityDefinition {
  abilityId: string;
  trigger: AbilityTrigger;
  targetRule: string;
  nameZh: string;
  descriptionZh: string;
}

export interface CardBalanceProfile {
  basePowerValue: number;
  immediateEffectValue: number;
  delayedEffectValue: number;
  ongoingEffectValue: number;
  disruptionValue: number;
  flexibilityValue: number;
  conditionDiscount: number;
  riskDiscount: number;
  expectedTotalValue: number;
  ceilingValue: number;
  floorValue: number;
}

export interface BalanceException {
  reason: string;
  compensatingRisk: string;
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
  abilities?: CardAbilitySpec[];
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
  packId?: string;
  role?: string;
  version: number;
  schemaVersion?: number;
  catalogVersion?: string;
  balance?: CardBalanceProfile;
  balanceException?: BalanceException;
  token?: boolean;
  imageKey?: string;
}

export type FrontComplexity = 'simple' | 'advanced' | 'chaotic';

export interface FrontPoolMetadata {
  weight: number;
  complexity: FrontComplexity;
  categories: string[];
  incompatibleWith?: string[];
  incompatibleTags?: string[];
  minimumClientVersion?: string;
  packId: string;
}

export interface FrontDefinition extends FrontPoolMetadata {
  frontId: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  effectId: string;
  effectArgs?: Record<string, unknown>;
  enabled: boolean;
  tags: string[];
  strategyZh: string;
}

export interface PowerModifier {
  source: string;
  amount: number;
  expiresTurn?: number;
}

export interface AbilityUsageState {
  total: number;
  turns: Record<string, number>;
  fronts: Record<string, number>;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId;
  currentPower: number;
  currentCost?: number;
  frontId: string;
  revealed: boolean;
  silenced: boolean;
  deployedTurn: number;
  modifiers: PowerModifier[];
  markers?: Record<string, number>;
  statuses?: string[];
  abilityUsage?: Record<string, AbilityUsageState>;
  moved?: boolean;
  createdByEffect?: boolean;
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

export interface PlayerCounters {
  deployments: number;
  moves: number;
  deaths: number;
  discards: number;
  cardsDrawn: number;
}

export interface PlayerState {
  playerId: PlayerId;
  name: string;
  deck: string[];
  hand: string[];
  fronts: Record<string, CardInstance[]>;
  graveyard: CardInstance[];
  discarded?: string[];
  energy: number;
  storedEnergy?: number;
  counters?: PlayerCounters;
  locked: boolean;
  intent?: TurnIntent;
  bannerUsed: boolean;
  withdrawn: boolean;
}

export interface FrontState {
  definition: FrontDefinition;
  revealed: boolean;
  revealedTurn?: number;
  blockedFor?: PlayerId | PlayerId[];
  movementBlockedFor?: PlayerId[];
  abilityBlockedFor?: PlayerId[];
  capacityModifiers?: Record<PlayerId, number>;
  state?: Record<string, unknown>;
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
  players: Array<{ playerId: PlayerId; name: string; deck: string[]; deckId?: string; deckName?: string }>;
  catalogVersion?: string;
  packVersions?: Record<string, string>;
}

export interface AbilityStackFrame {
  sourceInstanceId: string;
  abilityId: string;
  trigger: AbilityTrigger;
  depth: number;
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
  abilityStack?: AbilityStackFrame[];
  resolutionEventCount?: number;
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
  ability: CardAbilitySpec;
  sourceCardId: string;
  sourceInstanceId: string;
  sourcePlayerId: string;
  sourceFrontId?: string;
  targetPlayerId?: string;
  targetFrontId?: string;
  targetCardIds?: string[];
  triggeringInstanceId?: string;
  triggeringPlayerId?: string;
  triggeringFrontId?: string;
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
  catalogVersion?: string;
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

export interface SubmittedDeck {
  schemaVersion: number;
  deckId: string;
  name: string;
  cardIds: string[];
  catalogVersion: string;
  packVersions?: Record<string, string>;
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
