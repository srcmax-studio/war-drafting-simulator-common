import type {
  AbilityContext,
  CardDefinition,
  CardInstance,
  ComparisonOperator,
  FrontState,
  GameEvent,
  PlayerState
} from '../types.js';

export type AbilityTarget =
  | { kind: 'card'; owner: PlayerState; card: CardInstance }
  | { kind: 'card_id'; owner: PlayerState; zone: 'hand' | 'deck' | 'discard'; cardId: string; index: number }
  | { kind: 'player'; player: PlayerState }
  | { kind: 'front'; front: FrontState };

export function ownerOf(context: AbilityContext): PlayerState {
  const owner = context.gameState.players.find((player) => player.playerId === context.sourcePlayerId);
  if (!owner) throw new Error(`Ability owner does not exist: ${context.sourcePlayerId}`);
  return owner;
}

export function opponentOf(context: AbilityContext): PlayerState {
  const opponent = context.gameState.players.find((player) => player.playerId !== context.sourcePlayerId);
  if (!opponent) throw new Error(`Ability opponent does not exist: ${context.sourcePlayerId}`);
  return opponent;
}

export function sourceDefinition(context: AbilityContext): CardDefinition | undefined {
  return context.gameState.cardCatalog[context.sourceCardId];
}

export function findInstance(context: AbilityContext, instanceId = context.sourceInstanceId): { owner: PlayerState; card: CardInstance } | undefined {
  for (const owner of context.gameState.players) {
    for (const cards of Object.values(owner.fronts)) {
      const card = cards.find((candidate) => candidate.instanceId === instanceId);
      if (card) return { owner, card };
    }
  }
  return undefined;
}

export function targetKey(target: AbilityTarget): string {
  if (target.kind === 'card') return `card:${target.card.instanceId}`;
  if (target.kind === 'card_id') return `${target.zone}:${target.owner.playerId}:${target.index}:${target.cardId}`;
  if (target.kind === 'player') return `player:${target.player.playerId}`;
  return `front:${target.front.definition.frontId}`;
}

export function emit(
  context: AbilityContext,
  type: string,
  payload: Record<string, unknown>,
  options: { public?: boolean; playerId?: string } = {}
): GameEvent {
  const event: GameEvent = {
    sequence: 0,
    type,
    turn: context.turn,
    playerId: options.playerId ?? context.sourcePlayerId,
    public: options.public ?? true,
    payload: {
      sourceCardId: context.sourceCardId,
      sourceInstanceId: context.sourceInstanceId,
      abilityId: context.ability.abilityId,
      ...payload
    }
  };
  context.eventQueue.push(event);
  return event;
}

export function compare(actual: unknown, operator: ComparisonOperator = 'equals', expected: unknown): boolean {
  if (operator === 'includes' || operator === 'not_includes') {
    const included = Array.isArray(actual)
      ? actual.includes(expected)
      : String(actual ?? '').includes(String(expected ?? ''));
    return operator === 'includes' ? included : !included;
  }
  if (operator === 'equals') return actual === expected;
  if (operator === 'not_equals') return actual !== expected;
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'at_least') return left >= right;
  if (operator === 'at_most') return left <= right;
  if (operator === 'greater_than') return left > right;
  return left < right;
}

export function ensureInstanceState(card: CardInstance): void {
  card.markers ??= {};
  card.statuses ??= [];
  card.abilityUsage ??= {};
  card.currentCost ??= 0;
}

export function ensurePlayerState(player: PlayerState): void {
  player.discarded ??= [];
  player.storedEnergy ??= 0;
  player.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
}
