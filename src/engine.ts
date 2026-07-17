import { getCardAbilities, normalizeTrigger, ongoingPowerAdjustments, resolveAbility } from './abilities.js';
import { FRONT_DEFINITIONS, areFrontsCompatible, validateFrontDefinitions } from './fronts.js';
import { SeededRandom } from './rng.js';
import {
  DEFAULT_FRONT_CAPACITY,
  MAX_EVENTS_PER_RESOLUTION,
  PROTOCOL_VERSION,
  RuleError,
  STANDARD_TURNS,
  type AbilityTrigger,
  type CardDefinition,
  type CardInstance,
  type FrontDefinition,
  type FrontState,
  type GameEvent,
  type GameOptions,
  type GameState,
  type GameWinner,
  type PlayerId,
  type PlayerState,
  type PlayerView,
  type TurnIntent,
  type ValidationIssue,
  type ValidationResult
} from './types.js';
import { validateCardDefinitions, validateDeck } from './validation.js';

const clone = <T>(value: T): T => {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

function appendEvent(
  state: GameState,
  type: string,
  payload: Record<string, unknown>,
  options: { playerId?: PlayerId; public?: boolean } = {}
): GameEvent {
  if ((state.resolutionEventCount ?? 0) >= MAX_EVENTS_PER_RESOLUTION) {
    throw new RuleError('EVENT_LIMIT_EXCEEDED', 'Resolution event limit exceeded.');
  }
  if (state.eventLog.length >= MAX_EVENTS_PER_RESOLUTION * STANDARD_TURNS * 4) {
    throw new RuleError('EVENT_LIMIT_EXCEEDED', 'Game event limit exceeded.');
  }
  state.sequence += 1;
  const event: GameEvent = {
    sequence: state.sequence,
    type,
    turn: state.turn,
    public: options.public ?? true,
    payload
  };
  if (options.playerId !== undefined) event.playerId = options.playerId;
  state.eventLog.push(event);
  state.resolutionEventCount = (state.resolutionEventCount ?? 0) + 1;
  return event;
}

function flushAbilityEvents(state: GameState, events: GameEvent[]): void {
  for (const event of events) {
    appendEvent(state, event.type, event.payload, {
      ...(event.playerId === undefined ? {} : { playerId: event.playerId }),
      public: event.public
    });
  }
}

export function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  const found = state.players.find((item) => item.playerId === playerId);
  if (!found) throw new RuleError('PLAYER_NOT_FOUND', `Player does not exist: ${playerId}`);
  return found;
}

export function getOpponent(state: GameState, playerId: PlayerId): PlayerState {
  const found = state.players.find((item) => item.playerId !== playerId);
  if (!found) throw new RuleError('OPPONENT_NOT_FOUND', `Opponent does not exist for: ${playerId}`);
  return found;
}

export function getFrontState(state: GameState, frontId: string): FrontState {
  const slotMatch = /^front-slot-(\d+)$/.exec(frontId);
  const slotIndex = slotMatch ? Number(slotMatch[1]) - 1 : -1;
  const found = slotIndex >= 0 ? state.fronts[slotIndex] : state.fronts.find((item) => item.definition.frontId === frontId);
  if (!found) throw new RuleError('FRONT_NOT_FOUND', `Front does not exist: ${frontId}`);
  return found;
}

function canonicalFrontId(state: GameState, frontId: string): string | null {
  try { return getFrontState(state, frontId).definition.frontId; }
  catch { return null; }
}

function drawCards(state: GameState, owner: PlayerState, count: number): string[] {
  const drawn = owner.deck.splice(0, Math.max(0, count));
  owner.hand.push(...drawn);
  owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
  owner.counters.cardsDrawn += drawn.length;
  if (drawn.length > 0) {
    appendEvent(state, 'cards_drawn', { count: drawn.length, cardIds: [...drawn] }, { playerId: owner.playerId, public: false });
    appendEvent(state, 'opponent_drew', { count: drawn.length, playerId: owner.playerId });
  }
  for (const cardId of drawn) runCardTrigger(state, owner, undefined, cardId, 'on_draw');
  return drawn;
}

function selectFronts(rng: SeededRandom, fronts: readonly FrontDefinition[]): FrontDefinition[] {
  const enabled = fronts.filter((item) => item.enabled && item.weight > 0);
  if (enabled.length < 3) throw new RuleError('INSUFFICIENT_FRONTS', 'At least three fronts must be enabled.');
  const selected: FrontDefinition[] = [];
  while (selected.length < 3) {
    const compatible = enabled.filter((candidate) => !selected.some((item) => item.frontId === candidate.frontId) && areFrontsCompatible(selected, candidate));
    if (compatible.length === 0) throw new RuleError('INCOMPATIBLE_FRONT_POOL', 'Front pool cannot produce three compatible fronts.');
    const total = compatible.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = rng.next() * total;
    let candidate = compatible.at(-1)!;
    for (const item of compatible) {
      roll -= item.weight;
      if (roll <= 0) { candidate = item; break; }
    }
    selected.push(clone(candidate));
  }
  return selected;
}

function createPlayerState(
  player: GameOptions['players'][number],
  frontIds: string[],
  rng: SeededRandom
): PlayerState {
  return {
    playerId: player.playerId,
    name: player.name,
    deck: rng.shuffle(player.deck),
    hand: [],
    fronts: Object.fromEntries(frontIds.map((frontId) => [frontId, []])) as Record<string, CardInstance[]>,
    graveyard: [],
    discarded: [],
    energy: 1,
    storedEnergy: 0,
    counters: { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 },
    locked: false,
    bannerUsed: false,
    withdrawn: false
  };
}

export function createGame(options: GameOptions): GameState {
  if (options.players.length !== 2) throw new RuleError('INVALID_PLAYER_COUNT', 'Aeonfront requires exactly two players.');
  if (new Set(options.players.map((item) => item.playerId)).size !== 2) {
    throw new RuleError('DUPLICATE_PLAYER_ID', 'Player ids must be unique.');
  }
  const cardValidation = validateCardDefinitions(options.cards);
  if (!cardValidation.ok) throw new RuleError('INVALID_CARD_DATA', 'Card catalog is invalid.', { issues: cardValidation.issues });
  const frontErrors = validateFrontDefinitions(options.fronts);
  if (frontErrors.length > 0) throw new RuleError('INVALID_FRONT_DATA', 'Front catalog is invalid.', { issues: frontErrors });
  const cardCatalog = Object.fromEntries(options.cards.map((card) => [card.cardId, clone(card)]));
  for (const player of options.players) {
    const result = validateDeck(player.deck, cardCatalog);
    if (!result.ok) throw new RuleError('INVALID_DECK', `Invalid deck for ${player.playerId}.`, { issues: result.issues });
  }

  const rng = new SeededRandom(options.seed);
  const selectedFronts = selectFronts(rng, options.fronts);
  const frontIds = selectedFronts.map((item) => item.frontId);
  const players = options.players.map((player) => createPlayerState(player, frontIds, rng)) as [PlayerState, PlayerState];
  const state: GameState = {
    protocolVersion: PROTOCOL_VERSION,
    gameId: options.gameId ?? `aeonfront-${options.seed >>> 0}`,
    seed: options.seed >>> 0,
    rngState: rng.getState(),
    turn: 1,
    phase: 'planning',
    sequence: 0,
    nextInstanceId: 1,
    initiativePlayerId: players[rng.int(2)]!.playerId,
    fronts: selectedFronts.map((definition) => ({ definition, revealed: false })),
    players,
    stake: { current: 1, pending: null, pendingTurn: null, raisedBy: [] },
    winner: null,
    eventLog: [],
    processedRequestIds: [],
    cardCatalog,
    abilityStack: [],
    resolutionEventCount: 0,
    setup: {
      seed: options.seed >>> 0,
      cards: clone(options.cards),
      fronts: clone(options.fronts),
      players: clone(options.players),
      ...(options.catalogVersion ? { catalogVersion: options.catalogVersion } : {}),
      ...(options.packVersions ? { packVersions: clone(options.packVersions) } : {})
    }
  };
  state.rngState = rng.getState();
  appendEvent(state, 'game_created', { gameId: state.gameId, seed: state.seed, frontIds });
  for (const owner of state.players) drawCards(state, owner, 3);
  beginTurn(state);
  return state;
}

function runCardTrigger(
  state: GameState,
  owner: PlayerState,
  source: CardInstance | undefined,
  cardId: string,
  trigger: AbilityTrigger,
  triggering: { instanceId?: string; playerId?: string; frontId?: string } = {}
): void {
  const definition = state.cardCatalog[cardId];
  if (!definition || source?.silenced) return;
  const abilities = getCardAbilities(definition)
    .filter((ability) => normalizeTrigger(ability.trigger) === trigger)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.abilityId.localeCompare(right.abilityId));
  for (const ability of abilities) {
    const events = resolveAbility({
      gameState: state,
      ability,
      sourceCardId: cardId,
      sourceInstanceId: source?.instanceId ?? `zone-${owner.playerId}-${cardId}-${state.sequence}`,
      sourcePlayerId: owner.playerId,
      ...(source?.frontId ? { sourceFrontId: source.frontId } : {}),
      ...(triggering.instanceId ? { triggeringInstanceId: triggering.instanceId } : {}),
      ...(triggering.playerId ? { triggeringPlayerId: triggering.playerId } : {}),
      ...(triggering.frontId ? { triggeringFrontId: triggering.frontId } : {}),
      turn: state.turn,
      eventQueue: [],
      depth: 0
    });
    flushAbilityEvents(state, events);
  }
}

function revealCard(state: GameState, owner: PlayerState, card: CardInstance): void {
  if (card.revealed) return;
  card.revealed = true;
  appendEvent(state, 'card_revealed', { playerId: owner.playerId, instanceId: card.instanceId, cardId: card.cardId, frontId: card.frontId });
  runCardTrigger(state, owner, card, card.cardId, 'on_reveal');
  runCardTrigger(state, owner, card, card.cardId, 'after_reveal');
  runCardTrigger(state, owner, card, card.cardId, 'on_deploy');
}

function revealDelayedCards(state: GameState): void {
  for (const owner of state.players) {
    for (const cards of Object.values(owner.fronts)) {
      for (const card of cards) {
        if (!card.revealed && card.deployedTurn < state.turn) revealCard(state, owner, card);
      }
    }
  }
}

function applyPendingStake(state: GameState): void {
  if (state.stake.pending !== null && state.stake.pendingTurn !== null && state.stake.pendingTurn <= state.turn) {
    state.stake.current = state.stake.pending;
    state.stake.pending = null;
    state.stake.pendingTurn = null;
    appendEvent(state, 'stake_changed', { current: state.stake.current, reason: 'banner' });
  }
  if (state.turn === STANDARD_TURNS && state.stake.current < 8) {
    state.stake.current = Math.min(8, state.stake.current * 2) as 2 | 4 | 8;
    appendEvent(state, 'stake_changed', { current: state.stake.current, reason: 'final_turn' });
  }
}

function revealScheduledFronts(state: GameState): void {
  const scheduled = Math.min(state.turn - 1, 2);
  const lateIndex = state.fronts.findIndex((item) => item.definition.effectId === 'late_front_reveal');
  const index = scheduled === lateIndex && state.turn < asNumber(state.fronts[lateIndex]?.definition.effectArgs?.turn, 4) ? -1 : scheduled;
  const front = state.fronts[index];
  if (front && !front.revealed) revealFront(state, front, index);
  if (state.turn >= 2 && state.fronts.some((item) => item.definition.effectId === 'early_reveal')) {
    const third = state.fronts[2];
    if (third && !third.revealed) revealFront(state, third, 2, { early: true });
  }
  if (state.turn >= 2 && state.fronts.some((item) => item.definition.effectId === 'reveal_all_early')) {
    state.fronts.forEach((candidate, candidateIndex) => {
      if (!candidate.revealed) revealFront(state, candidate, candidateIndex, { early: true });
    });
  }
  if (state.turn >= 4 && lateIndex >= 0) {
    const late = state.fronts[lateIndex];
    if (late && !late.revealed) revealFront(state, late, lateIndex);
  }
}

function revealFront(state: GameState, front: FrontState, index: number, payload: Record<string, unknown> = {}): void {
  front.revealed = true;
  front.revealedTurn = state.turn;
  appendEvent(state, 'front_revealed', { frontId: front.definition.frontId, index, ...payload });
  runBoardTrigger(state, 'on_front_revealed', { frontId: front.definition.frontId });
}

function expireTemporaryModifiers(state: GameState): void {
  for (const owner of state.players) {
    for (const card of Object.values(owner.fronts).flat()) {
      const expired = card.modifiers.filter((modifier) => modifier.expiresTurn !== undefined && modifier.expiresTurn < state.turn);
      if (expired.length > 0) card.currentPower -= expired.reduce((sum, modifier) => sum + modifier.amount, 0);
      card.modifiers = card.modifiers.filter((modifier) => modifier.expiresTurn === undefined || modifier.expiresTurn >= state.turn);
      if (card.statuses) card.statuses = card.statuses.filter((status) => !status.startsWith('turn:'));
    }
  }
}

function beginTurn(state: GameState): void {
  state.phase = 'planning';
  state.resolutionEventCount = 0;
  expireTemporaryModifiers(state);
  applyPendingStake(state);
  revealScheduledFronts(state);
  revealDelayedCards(state);
  for (const owner of state.players) {
    owner.energy = state.turn + (owner.storedEnergy ?? 0);
    owner.storedEnergy = 0;
    owner.locked = false;
    delete owner.intent;
    drawCards(state, owner, 1);
  }
  runBoardTrigger(state, 'turn_start');
  state.initiativePlayerId = calculateInitiative(state);
  appendEvent(state, 'turn_started', { turn: state.turn, initiativePlayerId: state.initiativePlayerId, energy: state.turn });
}

export function getEffectiveCost(state: GameState, card: CardDefinition, frontId: string, playerId?: PlayerId, plannedBefore = false): number {
  const frontState = getFrontState(state, frontId);
  const front = frontState.definition;
  let result = card.cost;
  if (!frontState.revealed) return result;
  if (front.effectId === 'cost_down') result -= asNumber(front.effectArgs?.amount, 1);
  if (front.effectId === 'cost_up') result += asNumber(front.effectArgs?.amount, 1);
  if (front.effectId === 'future_beacon' && card.era === asString(front.effectArgs?.era, '未来时代')) result -= asNumber(front.effectArgs?.cost, 1);
  if (front.effectId === 'hand_cost_down' && card.cost >= asNumber(front.effectArgs?.threshold, 4)) result -= asNumber(front.effectArgs?.amount, 1);
  if (front.effectId === 'low_cost_surcharge' && card.cost <= asNumber(front.effectArgs?.threshold, 2)) result += asNumber(front.effectArgs?.amount, 1);
  if (front.effectId === 'final_turn_discount' && state.turn === asNumber(front.effectArgs?.turn, STANDARD_TURNS)) result -= asNumber(front.effectArgs?.amount, 2);
  if (playerId && ['high_cost_discount', 'first_card_discount'].includes(front.effectId)) {
    const alreadyPlayed = plannedBefore || (getPlayer(state, playerId).fronts[frontId] ?? []).some((instance) => instance.deployedTurn === state.turn);
    if (!alreadyPlayed && (front.effectId !== 'high_cost_discount' || card.cost >= asNumber(front.effectArgs?.threshold, 5))) {
      result -= asNumber(front.effectArgs?.amount, front.effectId === 'high_cost_discount' ? 2 : 1);
    }
  }
  return Math.max(1, Math.floor(result));
}

export function getFrontCapacity(state: GameState, playerId: PlayerId, frontId: string): number {
  const front = getFrontState(state, frontId);
  let capacity = DEFAULT_FRONT_CAPACITY;
  if (front.revealed && front.definition.effectId === 'capacity_up') capacity += asNumber(front.definition.effectArgs?.amount, 1);
  if (front.revealed && front.definition.effectId === 'capacity_down') capacity -= asNumber(front.definition.effectArgs?.amount, 1);
  if (front.revealed && front.definition.effectId === 'capacity_by_turn') {
    const turns = Array.isArray(front.definition.effectArgs?.turns) ? front.definition.effectArgs.turns.map(Number) : [3, 5];
    capacity += turns.filter((turn) => state.turn >= turn).length * asNumber(front.definition.effectArgs?.amount, 1);
  }
  capacity += front.capacityModifiers?.[playerId] ?? 0;
  const blocked = Array.isArray(front.blockedFor) ? front.blockedFor : front.blockedFor ? [front.blockedFor] : [];
  if (blocked.includes(playerId)) return 0;
  return Math.max(1, Math.floor(capacity));
}

function validateFrontRestriction(front: FrontState, card: CardDefinition): ValidationIssue | null {
  if (!front.revealed) return null;
  if (front.definition.effectId === 'ban_high_cost' && card.cost >= asNumber(front.definition.effectArgs?.threshold, 4)) {
    return { code: 'HIGH_COST_BLOCKED', message: `${card.nameZh} cannot be deployed to ${front.definition.nameZh}.` };
  }
  if (front.definition.effectId === 'ban_low_cost' && card.cost <= asNumber(front.definition.effectArgs?.threshold, 2)) {
    return { code: 'LOW_COST_BLOCKED', message: `${card.nameZh} cannot be deployed to ${front.definition.nameZh}.` };
  }
  return null;
}

export function validateTurnIntent(state: GameState, playerId: PlayerId, intent: TurnIntent): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (state.phase !== 'planning') issues.push({ code: 'NOT_PLANNING', message: 'The game is not accepting turn plans.' });
  if (state.winner) issues.push({ code: 'GAME_ENDED', message: 'The game has ended.' });
  if (intent.turn !== state.turn) issues.push({ code: 'TURN_MISMATCH', message: `Expected turn ${state.turn}.` });
  const owner = getPlayer(state, playerId);
  if (owner.locked) issues.push({ code: 'TURN_LOCKED', message: 'The turn is already locked.' });
  const deploymentIds = intent.deployments.map((item) => item.cardId);
  if (new Set(deploymentIds).size !== deploymentIds.length) issues.push({ code: 'DUPLICATE_DEPLOYMENT', message: 'A hand card can only be deployed once.' });
  const handCounts = new Map<string, number>();
  owner.hand.forEach((cardId) => handCounts.set(cardId, (handCounts.get(cardId) ?? 0) + 1));
  const laneAdds = new Map<string, number>();
  let totalCost = 0;
  for (const [index, deployment] of intent.deployments.entries()) {
    const card = state.cardCatalog[deployment.cardId];
    if (!card) {
      issues.push({ code: 'UNKNOWN_CARD', message: `Unknown card: ${deployment.cardId}`, path: `deployments[${index}]` });
      continue;
    }
    if ((handCounts.get(deployment.cardId) ?? 0) < 1) {
      issues.push({ code: 'CARD_NOT_IN_HAND', message: `${deployment.cardId} is not in this player's hand.`, path: `deployments[${index}]` });
    } else {
      handCounts.set(deployment.cardId, (handCounts.get(deployment.cardId) ?? 0) - 1);
    }
    const canonicalId = canonicalFrontId(state, deployment.frontId);
    const front = canonicalId ? state.fronts.find((item) => item.definition.frontId === canonicalId) : undefined;
    if (!front || !canonicalId) {
      issues.push({ code: 'UNKNOWN_FRONT', message: `Unknown front: ${deployment.frontId}`, path: `deployments[${index}]` });
      continue;
    }
    const restriction = validateFrontRestriction(front, card);
    if (restriction) issues.push({ ...restriction, path: `deployments[${index}]` });
    const plannedBefore = (laneAdds.get(canonicalId) ?? 0) > 0;
    totalCost += getEffectiveCost(state, card, canonicalId, playerId, plannedBefore);
    laneAdds.set(canonicalId, (laneAdds.get(canonicalId) ?? 0) + 1);
  }
  if (totalCost > owner.energy) issues.push({ code: 'INSUFFICIENT_ENERGY', message: `Plan costs ${totalCost}, but only ${owner.energy} military orders are available.` });
  for (const [frontId, additions] of laneAdds) {
    const occupied = owner.fronts[frontId]?.length ?? 0;
    if (occupied + additions > getFrontCapacity(state, playerId, frontId)) {
      issues.push({ code: 'FRONT_CAPACITY', message: `${frontId} does not have enough capacity.` });
    }
    const definition = getFrontState(state, frontId).definition;
    if (definition.effectId === 'single_deploy' && additions > asNumber(definition.effectArgs?.count, 1)) {
      issues.push({ code: 'FRONT_DEPLOYMENT_LIMIT', message: `${frontId} accepts only one deployment per turn.` });
    }
  }
  for (const [index, move] of (intent.moves ?? []).entries()) {
    const source = Object.values(owner.fronts).flat().find((card) => card.instanceId === move.instanceId);
    if (!source) issues.push({ code: 'INVALID_MOVE_SOURCE', message: `Card instance is not controlled by player: ${move.instanceId}`, path: `moves[${index}]` });
    const canonicalTargetId = canonicalFrontId(state, move.targetFrontId);
    if (!canonicalTargetId) {
      issues.push({ code: 'INVALID_MOVE_TARGET', message: `Unknown move target: ${move.targetFrontId}`, path: `moves[${index}]` });
    }
    const origin = source ? getFrontState(state, source.frontId) : undefined;
    const target = canonicalTargetId ? state.fronts.find((front) => front.definition.frontId === canonicalTargetId) : undefined;
    if (origin?.definition.effectId === 'no_move' || target?.definition.effectId === 'no_move' || origin?.movementBlockedFor?.includes(playerId) || target?.movementBlockedFor?.includes(playerId)) {
      issues.push({ code: 'MOVEMENT_BLOCKED', message: 'This movement is blocked by a front rule.', path: `moves[${index}]` });
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function submitTurnIntent(state: GameState, playerId: PlayerId, intent: TurnIntent): ValidationResult {
  if (state.processedRequestIds.includes(intent.requestId)) return { ok: true };
  const result = validateTurnIntent(state, playerId, intent);
  if (!result.ok) return result;
  const owner = getPlayer(state, playerId);
  const canonicalIntent: TurnIntent = {
    ...clone(intent),
    deployments: intent.deployments.map((deployment) => ({ ...deployment, frontId: canonicalFrontId(state, deployment.frontId) ?? deployment.frontId })),
    ...(intent.moves ? { moves: intent.moves.map((move) => ({ ...move, targetFrontId: canonicalFrontId(state, move.targetFrontId) ?? move.targetFrontId })) } : {})
  };
  owner.intent = canonicalIntent;
  state.processedRequestIds.push(intent.requestId);
  appendEvent(state, 'turn_submitted', { intent: clone(canonicalIntent) }, { playerId, public: false });
  appendEvent(state, 'turn_plan_updated', { playerId, deploymentCount: intent.deployments.length }, { playerId, public: false });
  return { ok: true };
}

export function undoTurnIntent(state: GameState, playerId: PlayerId, requestId: string): ValidationResult {
  if (state.processedRequestIds.includes(requestId)) return { ok: true };
  const owner = getPlayer(state, playerId);
  if (owner.locked) return { ok: false, issues: [{ code: 'TURN_LOCKED', message: 'A locked plan cannot be undone.' }] };
  delete owner.intent;
  state.processedRequestIds.push(requestId);
  appendEvent(state, 'turn_undone', { requestId }, { playerId, public: false });
  appendEvent(state, 'turn_plan_updated', { playerId, deploymentCount: 0 }, { playerId, public: false });
  return { ok: true };
}

function movePlannedCards(state: GameState, owner: PlayerState, intent: TurnIntent): void {
  for (const move of intent.moves ?? []) {
    let sourceFrontId: string | null = null;
    let moving: CardInstance | undefined;
    for (const [frontId, cards] of Object.entries(owner.fronts)) {
      const found = cards.find((card) => card.instanceId === move.instanceId);
      if (found) {
        sourceFrontId = frontId;
        moving = found;
        break;
      }
    }
    if (!moving || !sourceFrontId || sourceFrontId === move.targetFrontId) continue;
    const target = owner.fronts[move.targetFrontId];
    if (!target || target.length >= getFrontCapacity(state, owner.playerId, move.targetFrontId)) continue;
    runCardTrigger(state, owner, moving, moving.cardId, 'before_move', { instanceId: moving.instanceId, playerId: owner.playerId, frontId: move.targetFrontId });
    owner.fronts[sourceFrontId] = owner.fronts[sourceFrontId]!.filter((card) => card.instanceId !== moving?.instanceId);
    moving.frontId = move.targetFrontId;
    moving.moved = true;
    target.push(moving);
    owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
    owner.counters.moves += 1;
    appendEvent(state, 'card_moved', { playerId: owner.playerId, instanceId: moving.instanceId, from: sourceFrontId, to: move.targetFrontId });
    runCardTrigger(state, owner, moving, moving.cardId, 'after_move', { instanceId: moving.instanceId, playerId: owner.playerId, frontId: sourceFrontId });
  }
}

function runBoardTrigger(state: GameState, trigger: AbilityTrigger, triggering: { instanceId?: string; playerId?: string; frontId?: string } = {}): void {
  const snapshot = state.players.flatMap((owner) =>
    Object.values(owner.fronts).flatMap((cards) => cards.map((card) => ({ owner, card })))
  ).sort((left, right) => left.card.deployedTurn - right.card.deployedTurn || left.card.instanceId.localeCompare(right.card.instanceId));
  for (const { owner, card } of snapshot) {
    if (card.revealed && !card.silenced) runCardTrigger(state, owner, card, card.cardId, trigger, triggering);
  }
}

function runPlayedReactions(state: GameState, playedOwner: PlayerState, source: CardInstance): void {
  const snapshot = state.players.flatMap((owner) => Object.values(owner.fronts).flatMap((cards) => cards.map((card) => ({ owner, card }))));
  for (const candidate of snapshot) {
    if (candidate.card.instanceId === source.instanceId || !candidate.card.revealed || candidate.card.silenced) continue;
    const triggering = { instanceId: source.instanceId, playerId: playedOwner.playerId, frontId: source.frontId };
    if (candidate.card.frontId === source.frontId) runCardTrigger(state, candidate.owner, candidate.card, candidate.card.cardId, 'after_card_played_here', triggering);
    runCardTrigger(state, candidate.owner, candidate.card, candidate.card.cardId, candidate.owner.playerId === playedOwner.playerId ? 'after_ally_played' : 'after_enemy_played', triggering);
  }
}

function deployCards(state: GameState, owner: PlayerState, intent: TurnIntent): void {
  movePlannedCards(state, owner, intent);
  const sorted = [...intent.deployments].sort((left, right) => left.order - right.order || left.cardId.localeCompare(right.cardId));
  for (const deployment of sorted) {
    const handIndex = owner.hand.indexOf(deployment.cardId);
    if (handIndex < 0) {
      appendEvent(state, 'deployment_fizzled', { playerId: owner.playerId, cardId: deployment.cardId, frontId: deployment.frontId, reason: 'card_left_hand' });
      continue;
    }
    const definition = state.cardCatalog[deployment.cardId];
    if (!definition) throw new RuleError('UNKNOWN_CARD', `Unknown card: ${deployment.cardId}`);
    const front = getFrontState(state, deployment.frontId);
    if ((owner.fronts[deployment.frontId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, deployment.frontId)) {
      appendEvent(state, 'deployment_fizzled', { playerId: owner.playerId, cardId: deployment.cardId, frontId: deployment.frontId, reason: 'front_capacity' });
      continue;
    }
    if (validateFrontRestriction(front, definition)) {
      appendEvent(state, 'deployment_fizzled', { playerId: owner.playerId, cardId: deployment.cardId, frontId: deployment.frontId, reason: 'front_restriction' });
      continue;
    }
    const cost = getEffectiveCost(state, definition, deployment.frontId, owner.playerId);
    if (cost > owner.energy) {
      appendEvent(state, 'deployment_fizzled', { playerId: owner.playerId, cardId: deployment.cardId, frontId: deployment.frontId, reason: 'energy_changed' });
      continue;
    }
    runCardTrigger(state, owner, undefined, definition.cardId, 'before_play', { playerId: owner.playerId, frontId: deployment.frontId });
    owner.energy = Math.max(0, owner.energy - cost);
    owner.hand.splice(handIndex, 1);
    const abilities = getCardAbilities(definition);
    const delayed = abilities.some((ability) => ability.abilityId === 'ambush') || front.revealed && ['delayed_reveal', 'reverse_reveal'].includes(front.definition.effectId);
    const source: CardInstance = {
      instanceId: `${state.gameId}-${state.nextInstanceId}`,
      cardId: definition.cardId,
      ownerId: owner.playerId,
      currentPower: definition.power,
      frontId: deployment.frontId,
      currentCost: definition.cost,
      revealed: false,
      silenced: front.revealed && front.definition.effectId === 'silence',
      deployedTurn: state.turn,
      modifiers: [],
      markers: {},
      statuses: [],
      abilityUsage: {},
      moved: false,
      createdByEffect: false
    };
    state.nextInstanceId += 1;
    owner.fronts[deployment.frontId]?.push(source);
    owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
    owner.counters.deployments += 1;
    appendEvent(state, 'card_deployed', {
      playerId: owner.playerId,
      instanceId: source.instanceId,
      cardId: delayed ? null : source.cardId,
      frontId: source.frontId,
      revealed: !delayed
    });
    runCardTrigger(state, owner, source, source.cardId, 'on_play', { instanceId: source.instanceId, playerId: owner.playerId, frontId: source.frontId });
    if (!delayed) {
      revealCard(state, owner, source);
      if (front.revealed && front.definition.effectId === 'repeat_reveal') runCardTrigger(state, owner, source, source.cardId, 'on_deploy');
    }
    if (front.revealed && front.definition.effectId === 'first_play_bonus' && (owner.fronts[source.frontId] ?? []).filter((card) => card.deployedTurn === state.turn).length === 1) {
      const bonus = asNumber(front.definition.effectArgs?.amount, 2);
      source.currentPower += bonus;
      source.modifiers.push({ source: `front:${source.frontId}:first`, amount: bonus });
    }
    if (front.revealed && front.definition.effectId === 'last_slot_bonus' && (owner.fronts[source.frontId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, source.frontId)) {
      const bonus = asNumber(front.definition.effectArgs?.amount, 4);
      source.currentPower += bonus;
      source.modifiers.push({ source: `front:${source.frontId}:last`, amount: bonus });
    }
    if (front.revealed && front.definition.effectId === 'modern_exchange' && (front.definition.effectArgs?.eras as unknown[] | undefined)?.includes(definition.era)) {
      front.state ??= {};
      const key = `drawn:${owner.playerId}`;
      if (!front.state[key]) { front.state[key] = true; drawCards(state, owner, asNumber(front.definition.effectArgs?.count, 1)); }
    }
    runPlayedReactions(state, owner, source);
  }
}

function moveInstance(state: GameState, owner: PlayerState, card: CardInstance, targetId: string, reason: string): number {
  const origin = getFrontState(state, card.frontId);
  const target = getFrontState(state, targetId);
  if (card.frontId === targetId || origin.definition.effectId === 'no_move' || target.definition.effectId === 'no_move') return 0;
  if (origin.movementBlockedFor?.includes(owner.playerId) || target.movementBlockedFor?.includes(owner.playerId)) return 0;
  if ((owner.fronts[targetId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, targetId)) return 0;
  runCardTrigger(state, owner, card, card.cardId, 'before_move', { instanceId: card.instanceId, playerId: owner.playerId, frontId: targetId });
  const fromId = card.frontId;
  owner.fronts[fromId] = owner.fronts[fromId]!.filter((item) => item.instanceId !== card.instanceId);
  card.frontId = targetId;
  card.moved = true;
  owner.fronts[targetId]!.push(card);
  owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
  owner.counters.moves += 1;
  appendEvent(state, 'card_moved', { playerId: owner.playerId, instanceId: card.instanceId, from: fromId, to: targetId, reason });
  runCardTrigger(state, owner, card, card.cardId, 'after_move', { instanceId: card.instanceId, playerId: owner.playerId, frontId: fromId });
  return 1;
}

function moveOneLeft(state: GameState, owner: PlayerState): number {
  for (let index = state.fronts.length - 1; index > 0; index -= 1) {
    const fromId = state.fronts[index]?.definition.frontId;
    const toId = state.fronts[index - 1]?.definition.frontId;
    if (!fromId || !toId) continue;
    const card = owner.fronts[fromId]?.at(-1);
    if (!card) continue;
    const changed = moveInstance(state, owner, card, toId, 'front_left');
    if (changed) return changed;
  }
  return 0;
}

function moveOneRight(state: GameState, owner: PlayerState): number {
  for (let index = 0; index < state.fronts.length - 1; index += 1) {
    const fromId = state.fronts[index]?.definition.frontId;
    const toId = state.fronts[index + 1]?.definition.frontId;
    if (!fromId || !toId) continue;
    const card = owner.fronts[fromId]?.at(-1);
    if (!card) continue;
    const changed = moveInstance(state, owner, card, toId, 'front_right');
    if (changed) return changed;
  }
  return 0;
}

function moveRandom(state: GameState, owner: PlayerState, rng: SeededRandom): number {
  const candidates = Object.values(owner.fronts).flat();
  if (candidates.length === 0) return 0;
  const card = rng.pick(candidates);
  const fromIndex = state.fronts.findIndex((item) => item.definition.frontId === card.frontId);
  const targetIndexes = [fromIndex - 1, fromIndex + 1].filter((index) => index >= 0 && index < state.fronts.length);
  if (targetIndexes.length === 0) return 0;
  const targetId = state.fronts[rng.pick(targetIndexes)]?.definition.frontId;
  return targetId ? moveInstance(state, owner, card, targetId, 'front_random') : 0;
}

function runDestroyedReactions(state: GameState, destroyedOwner: PlayerState, card: CardInstance): void {
  const snapshot = state.players.flatMap((owner) => Object.values(owner.fronts).flatMap((cards) => cards.map((candidate) => ({ owner, card: candidate }))));
  for (const candidate of snapshot) {
    if (!candidate.card.revealed || candidate.card.silenced) continue;
    runCardTrigger(
      state,
      candidate.owner,
      candidate.card,
      candidate.card.cardId,
      candidate.owner.playerId === destroyedOwner.playerId ? 'after_ally_destroyed' : 'after_enemy_destroyed',
      { instanceId: card.instanceId, playerId: destroyedOwner.playerId, frontId: card.frontId }
    );
  }
}

function destroyInstance(state: GameState, owner: PlayerState, card: CardInstance, reason: string): number {
  if (card.statuses?.includes('immune') || card.statuses?.includes('protected')) return 0;
  const lane = owner.fronts[card.frontId] ?? [];
  if (!lane.some((candidate) => candidate.instanceId === card.instanceId)) return 0;
  runCardTrigger(state, owner, card, card.cardId, 'on_destroy', { instanceId: card.instanceId, playerId: owner.playerId, frontId: card.frontId });
  owner.fronts[card.frontId] = lane.filter((candidate) => candidate.instanceId !== card.instanceId);
  owner.graveyard.push(card);
  owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
  owner.counters.deaths += 1;
  const origin = getFrontState(state, card.frontId);
  if (origin.definition.effectId === 'first_death_revive') {
    origin.state ??= {};
    const key = `fallen:${owner.playerId}`;
    if (!origin.state[key]) origin.state[key] = card.instanceId;
  }
  appendEvent(state, 'card_destroyed', { playerId: owner.playerId, instanceId: card.instanceId, cardId: card.cardId, reason });
  for (const boon of state.fronts.filter((front) => front.definition.effectId === 'death_boon' && front.definition.frontId !== card.frontId)) {
    const weakest = [...(owner.fronts[boon.definition.frontId] ?? [])].sort((left, right) => left.currentPower - right.currentPower || left.instanceId.localeCompare(right.instanceId))[0];
    if (weakest) {
      const amount = asNumber(boon.definition.effectArgs?.amount, 2);
      weakest.currentPower += amount;
      weakest.modifiers.push({ source: `front:${boon.definition.frontId}:death`, amount });
    }
  }
  runDestroyedReactions(state, owner, card);
  return 1;
}

function discardOne(state: GameState, owner: PlayerState, reason: string): number {
  const cardId = owner.hand.shift();
  if (!cardId) return 0;
  owner.discarded ??= [];
  owner.discarded.push(cardId);
  owner.counters ??= { deployments: 0, moves: 0, deaths: 0, discards: 0, cardsDrawn: 0 };
  owner.counters.discards += 1;
  appendEvent(state, 'card_discarded', { playerId: owner.playerId, cardId, reason });
  runCardTrigger(state, owner, undefined, cardId, 'on_discard', { playerId: owner.playerId });
  return 1;
}

export function applyFrontTurnEffect(state: GameState, frontId: string, suppliedRng?: SeededRandom): { applied: boolean; changed: number } {
  const front = getFrontState(state, frontId);
  const effectId = front.definition.effectId;
  const rng = suppliedRng ?? SeededRandom.fromState(state.rngState);
  let changed = 0;
  switch (effectId) {
    case 'move_left':
      for (const owner of state.players) changed += moveOneLeft(state, owner);
      break;
    case 'random_move':
      for (const owner of state.players) changed += moveRandom(state, owner, rng);
      break;
    case 'move_right':
      for (const owner of state.players) changed += moveOneRight(state, owner);
      break;
    case 'center_reinforce': {
      const centerId = state.fronts[1]?.definition.frontId;
      if (centerId) for (const owner of state.players) {
        for (const side of [state.fronts[0]?.definition.frontId, state.fronts[2]?.definition.frontId]) {
          const card = side ? owner.fronts[side]?.at(-1) : undefined;
          if (card) changed += moveInstance(state, owner, card, centerId, 'front_center');
        }
      }
      break;
    }
    case 'flank_reinforce': {
      const centerId = state.fronts[1]?.definition.frontId;
      if (centerId) for (const owner of state.players) {
        const card = owner.fronts[centerId]?.at(-1);
        const sides = [state.fronts[0]?.definition.frontId, state.fronts[2]?.definition.frontId].filter((value): value is string => Boolean(value));
        const targetId = sides.sort((left, right) => (owner.fronts[left]?.reduce((sum, item) => sum + item.currentPower, 0) ?? 0) - (owner.fronts[right]?.reduce((sum, item) => sum + item.currentPower, 0) ?? 0))[0];
        if (card && targetId) changed += moveInstance(state, owner, card, targetId, 'front_flank');
      }
      break;
    }
    case 'rotate_positions':
      if (state.turn % asNumber(front.definition.effectArgs?.every, 2) === 0) for (const owner of state.players) changed += moveOneRight(state, owner);
      break;
    case 'swap_adjacent': {
      const sourceIndex = state.fronts.findIndex((candidate) => candidate.definition.frontId === frontId);
      const adjacentId = state.fronts[sourceIndex === 0 ? 1 : sourceIndex - 1]?.definition.frontId;
      if (adjacentId) for (const owner of state.players) {
        const strongest = [...(owner.fronts[frontId] ?? [])].sort((a, b) => b.currentPower - a.currentPower || a.instanceId.localeCompare(b.instanceId))[0];
        const weakest = [...(owner.fronts[adjacentId] ?? [])].sort((a, b) => a.currentPower - b.currentPower || a.instanceId.localeCompare(b.instanceId))[0];
        if (strongest && weakest) {
          owner.fronts[frontId] = owner.fronts[frontId]!.filter((card) => card.instanceId !== strongest.instanceId);
          owner.fronts[adjacentId] = owner.fronts[adjacentId]!.filter((card) => card.instanceId !== weakest.instanceId);
          strongest.frontId = adjacentId;
          weakest.frontId = frontId;
          owner.fronts[frontId]!.push(weakest);
          owner.fronts[adjacentId]!.push(strongest);
          changed += 2;
        }
      }
      break;
    }
    case 'recruit':
      for (const owner of state.players) {
        if ((owner.fronts[frontId]?.length ?? 0) > 0) changed += drawCards(state, owner, asNumber(front.definition.effectArgs?.count, 1)).length;
      }
      break;
    case 'copy':
      for (const owner of state.players) {
        const source = owner.fronts[frontId]?.find((card) => !card.modifiers.some((modifier) => modifier.source === `front:${frontId}:copied`));
        if (source) {
          owner.hand.push(source.cardId);
          source.modifiers.push({ source: `front:${frontId}:copied`, amount: 0 });
          appendEvent(state, 'card_copied', { playerId: owner.playerId, cardId: source.cardId, reason: 'front' });
          changed += 1;
        }
      }
      break;
    case 'discard': {
      const max = Math.max(...state.players.map((owner) => owner.hand.length));
      const targets = state.players.filter((owner) => owner.hand.length === max && max > 0);
      if (targets.length === 1) {
        changed += discardOne(state, targets[0]!, 'front');
      }
      break;
    }
    case 'destroy': {
      const candidates = state.players.flatMap((owner) =>
        (owner.fronts[frontId] ?? []).filter((card) => card.revealed).map((card) => ({ owner, card }))
      );
      const victim = candidates.sort((left, right) => left.card.currentPower - right.card.currentPower || left.card.instanceId.localeCompare(right.card.instanceId))[0];
      if (victim) {
        changed = destroyInstance(state, victim.owner, victim.card, 'front');
      }
      break;
    }
    case 'return':
      for (const owner of state.players) {
        const restored = owner.graveyard.shift();
        if (restored) {
          owner.hand.push(restored.cardId);
          appendEvent(state, 'card_returned', { playerId: owner.playerId, cardId: restored.cardId, reason: 'front' });
          runCardTrigger(state, owner, undefined, restored.cardId, 'on_return_to_hand', { playerId: owner.playerId, frontId });
          changed += 1;
        }
      }
      break;
    case 'turn_draw': {
      const turns = Array.isArray(front.definition.effectArgs?.turns) ? front.definition.effectArgs.turns.map(Number) : [3, 5];
      if (turns.includes(state.turn)) for (const owner of state.players) if ((owner.fronts[frontId]?.length ?? 0) > 0) changed += drawCards(state, owner, asNumber(front.definition.effectArgs?.count, 1)).length;
      break;
    }
    case 'unused_energy_power':
      front.state ??= {};
      for (const owner of state.players) {
        const key = `reserve:${owner.playerId}`;
        const gain = owner.energy * asNumber(front.definition.effectArgs?.amount, 1);
        front.state[key] = asNumber(front.state[key], 0) + gain;
        changed += gain;
      }
      break;
    case 'shuffle_discard':
      for (const owner of state.players) {
        const cardId = owner.discarded?.shift();
        if (!cardId) continue;
        owner.deck.splice(rng.int(owner.deck.length + 1), 0, cardId);
        changed += 1 + drawCards(state, owner, asNumber(front.definition.effectArgs?.count, 1)).length;
      }
      break;
    case 'first_death_revive':
      front.state ??= {};
      for (const owner of state.players) {
        const key = `fallen:${owner.playerId}`;
        const instanceId = asString(front.state[key]);
        const card = owner.graveyard.find((candidate) => candidate.instanceId === instanceId);
        if (!card || (owner.fronts[frontId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, frontId)) continue;
        owner.graveyard = owner.graveyard.filter((candidate) => candidate.instanceId !== card.instanceId);
        card.frontId = frontId;
        card.revealed = true;
        const amount = asNumber(front.definition.effectArgs?.amount, 2);
        card.currentPower += amount;
        card.modifiers.push({ source: `front:${frontId}:revive`, amount });
        owner.fronts[frontId]!.push(card);
        delete front.state[key];
        changed += 1;
      }
      break;
    case 'front_closes':
      if (state.turn === asNumber(front.definition.effectArgs?.turn, 5)) {
        for (const owner of state.players) for (const card of [...(owner.fronts[frontId] ?? [])]) changed += destroyInstance(state, owner, card, 'front_closed');
      }
      break;
    case 'leader_pressure': {
      const [first, second] = state.players;
      const firstPower = (first.fronts[frontId] ?? []).reduce((sum, card) => sum + card.currentPower, 0);
      const secondPower = (second.fronts[frontId] ?? []).reduce((sum, card) => sum + card.currentPower, 0);
      if (firstPower !== secondPower) {
        const leader = firstPower > secondPower ? first : second;
        const trailer = leader === first ? second : first;
        const strongest = [...(leader.fronts[frontId] ?? [])].sort((a, b) => b.currentPower - a.currentPower)[0];
        const weakest = [...(trailer.fronts[frontId] ?? [])].sort((a, b) => a.currentPower - b.currentPower)[0];
        const amount = asNumber(front.definition.effectArgs?.amount, 2);
        if (strongest) { strongest.currentPower -= amount; changed += 1; }
        if (weakest) { weakest.currentPower += amount; changed += 1; }
      }
      break;
    }
    case 'silence':
      for (const owner of state.players) {
        for (const card of owner.fronts[frontId] ?? []) {
          if (!card.silenced) changed += 1;
          card.silenced = true;
        }
      }
      break;
    case 'cost_down':
    case 'cost_up':
    case 'base_power_up':
    case 'base_power_down':
    case 'era_bonus':
    case 'region_bonus':
    case 'profession_bonus':
    case 'identity_bonus':
    case 'capacity_up':
    case 'capacity_down':
    case 'ban_high_cost':
    case 'ban_low_cost':
    case 'repeat_reveal':
    case 'delayed_reveal':
    case 'early_reveal':
    case 'hidden_power':
    case 'invert_power':
    case 'negative_bonus':
    case 'vanilla_bonus':
    case 'solo_bonus':
    case 'full_bonus':
    case 'cross_era_bonus':
    case 'ancient_concord':
    case 'medieval_bastion':
    case 'modern_exchange':
    case 'future_beacon':
    case 'same_era_focus':
    case 'era_diversity':
    case 'same_region_focus':
    case 'region_diversity':
    case 'faction_muster':
    case 'profession_conclave':
    case 'tag_chain':
    case 'identity_council':
    case 'no_move':
    case 'capacity_by_turn':
    case 'single_deploy':
    case 'first_play_bonus':
    case 'last_slot_bonus':
    case 'hand_cost_down':
    case 'low_cost_surcharge':
    case 'high_cost_discount':
    case 'first_card_discount':
    case 'final_turn_discount':
    case 'discard_reward':
    case 'reverse_reveal':
    case 'unrevealed_bonus':
    case 'late_front_reveal':
    case 'concealed_lane':
    case 'reveal_all_early':
    case 'graveyard_power':
    case 'death_boon':
    case 'shared_margin':
      break;
    default:
      return { applied: false, changed: 0 };
  }
  state.rngState = rng.getState();
  appendEvent(state, 'front_effect_resolved', { frontId, effectId, changed });
  return { applied: true, changed };
}

function resolveAllFrontEffects(state: GameState): void {
  const rng = SeededRandom.fromState(state.rngState);
  for (const front of state.fronts) {
    if (front.revealed) applyFrontTurnEffect(state, front.definition.frontId, rng);
  }
  state.rngState = rng.getState();
}

export function calculateFrontPower(state: GameState, playerId: PlayerId, frontId: string): number {
  const owner = getPlayer(state, playerId);
  const opponent = getOpponent(state, playerId);
  const lane = owner.fronts[frontId] ?? [];
  const frontState = getFrontState(state, frontId);
  const front = frontState.definition;
  let total = lane.reduce((sum, card) => sum + card.currentPower, 0);
  for (const sourceOwner of state.players) {
    for (const source of Object.values(sourceOwner.fronts).flat()) {
      const definition = state.cardCatalog[source.cardId];
      if (!definition || !source.revealed || source.silenced) continue;
      for (const ability of getCardAbilities(definition).filter((candidate) => candidate.trigger === 'ongoing')) {
        const adjustments = ongoingPowerAdjustments({
          gameState: state,
          ability,
          sourceCardId: source.cardId,
          sourceInstanceId: source.instanceId,
          sourcePlayerId: sourceOwner.playerId,
          sourceFrontId: source.frontId,
          turn: state.turn,
          eventQueue: [],
          depth: 0
        });
        for (const card of lane) total += adjustments.get(card.instanceId) ?? 0;
      }
    }
  }
  const value = asNumber(front.effectArgs?.amount, 0);
  const definitions = lane.map((card) => state.cardCatalog[card.cardId]).filter((card): card is CardDefinition => Boolean(card));
  const groupCount = (field: 'era' | 'region' | 'faction' | 'profession' | 'identity'): Map<string, number> => {
    const groups = new Map<string, number>();
    for (const definition of definitions) groups.set(definition[field], (groups.get(definition[field]) ?? 0) + 1);
    return groups;
  };
  switch (front.effectId) {
    case 'base_power_up': total += lane.length * value; break;
    case 'base_power_down': total -= lane.length * value; break;
    case 'era_bonus': total += lane.filter((card) => state.cardCatalog[card.cardId]?.era === asString(front.effectArgs?.era)).length * value; break;
    case 'region_bonus': total += lane.filter((card) => state.cardCatalog[card.cardId]?.region === asString(front.effectArgs?.region)).length * value; break;
    case 'profession_bonus': total += lane.filter((card) => state.cardCatalog[card.cardId]?.profession.includes(asString(front.effectArgs?.professionIncludes))).length * value; break;
    case 'identity_bonus': {
      const identities = Array.isArray(front.effectArgs?.identities) ? front.effectArgs.identities.filter((item): item is string => typeof item === 'string') : [];
      total += lane.filter((card) => identities.includes(state.cardCatalog[card.cardId]?.identity ?? '')).length * value;
      break;
    }
    case 'invert_power': if (state.turn === STANDARD_TURNS) total *= -1; break;
    case 'negative_bonus': total += lane.filter((card) => card.currentPower < 0).length * value; break;
    case 'vanilla_bonus': total += lane.filter((card) => card.silenced || getCardAbilities(state.cardCatalog[card.cardId]!).length === 0).length * value; break;
    case 'solo_bonus': if (lane.length === 1) total += value; break;
    case 'full_bonus': if (lane.length >= getFrontCapacity(state, playerId, frontId)) total += value; break;
    case 'cross_era_bonus': total += new Set(lane.map((card) => state.cardCatalog[card.cardId]?.era).filter(Boolean)).size * value; break;
    case 'ancient_concord': {
      const eras = Array.isArray(front.effectArgs?.eras) ? front.effectArgs.eras : [];
      total += definitions.filter((card) => eras.includes(card.era)).length * value;
      break;
    }
    case 'medieval_bastion': {
      const term = asString(front.effectArgs?.eraIncludes, '中世纪');
      const penalty = asNumber(front.effectArgs?.penalty, 1);
      total += definitions.reduce((sum, card) => sum + (card.era.includes(term) ? value : -penalty), 0);
      break;
    }
    case 'future_beacon': total += definitions.filter((card) => card.era === asString(front.effectArgs?.era, '未来时代')).length * value; break;
    case 'same_era_focus': if (lane.length > 0 && groupCount('era').size === 1) total += value; break;
    case 'era_diversity': total += groupCount('era').size * value; break;
    case 'same_region_focus': if (lane.length > 0 && groupCount('region').size === 1) total += value; break;
    case 'region_diversity': total += groupCount('region').size * value; break;
    case 'faction_muster': total += [...groupCount('faction').values()].reduce((sum, count) => sum + count * Math.max(0, count - 1) * value, 0); break;
    case 'profession_conclave': total += [...groupCount('profession').values()].reduce((sum, count) => sum + Math.max(0, count - 1) * value, 0); break;
    case 'tag_chain': {
      const qualifying = new Set<string>();
      for (let index = 0; index < lane.length - 1; index += 1) {
        const left = state.cardCatalog[lane[index]!.cardId];
        const right = state.cardCatalog[lane[index + 1]!.cardId];
        if (left?.tags.some((tag) => right?.tags.includes(tag))) { qualifying.add(lane[index]!.instanceId); qualifying.add(lane[index + 1]!.instanceId); }
      }
      total += qualifying.size * value;
      break;
    }
    case 'identity_council': total += groupCount('identity').size * value; break;
    case 'unrevealed_bonus': total += lane.filter((card) => !card.revealed).length * value; break;
    case 'unused_energy_power': total += asNumber(frontState.state?.[`reserve:${playerId}`], 0); break;
    case 'discard_reward': total += (owner.counters?.discards ?? 0) * value; break;
    case 'graveyard_power': total += Math.min(asNumber(front.effectArgs?.maximum, 6), owner.graveyard.length * value); break;
  }
  for (const sharingFront of state.fronts.filter((candidate) => candidate.definition.effectId === 'shared_margin' && candidate.definition.frontId !== frontId)) {
    const sharingId = sharingFront.definition.frontId;
    const own = (owner.fronts[sharingId] ?? []).reduce((sum, card) => sum + card.currentPower, 0);
    const enemy = (opponent.fronts[sharingId] ?? []).reduce((sum, card) => sum + card.currentPower, 0);
    if (own <= enemy) continue;
    const alternatives = state.fronts.filter((candidate) => candidate.definition.frontId !== sharingId)
      .map((candidate) => ({ id: candidate.definition.frontId, power: (owner.fronts[candidate.definition.frontId] ?? []).reduce((sum, card) => sum + card.currentPower, 0) }))
      .sort((left, right) => left.power - right.power || left.id.localeCompare(right.id));
    if (alternatives[0]?.id === frontId) total += Math.floor((own - enemy) * asNumber(sharingFront.definition.effectArgs?.ratio, 0.5));
  }
  return total;
}

function frontWinner(state: GameState, frontId: string): PlayerId | null {
  const [first, second] = state.players;
  const firstPower = calculateFrontPower(state, first.playerId, frontId);
  const secondPower = calculateFrontPower(state, second.playerId, frontId);
  if (firstPower === secondPower) return null;
  return firstPower > secondPower ? first.playerId : second.playerId;
}

export function calculateInitiative(state: GameState): PlayerId {
  const [first, second] = state.players;
  const revealed = state.fronts.filter((front) => front.revealed);
  const control = new Map<PlayerId, number>([[first.playerId, 0], [second.playerId, 0]]);
  for (const front of revealed) {
    const winner = frontWinner(state, front.definition.frontId);
    if (winner) control.set(winner, (control.get(winner) ?? 0) + 1);
  }
  if ((control.get(first.playerId) ?? 0) !== (control.get(second.playerId) ?? 0)) {
    return (control.get(first.playerId) ?? 0) > (control.get(second.playerId) ?? 0) ? first.playerId : second.playerId;
  }
  const firstTotal = revealed.reduce((sum, front) => sum + calculateFrontPower(state, first.playerId, front.definition.frontId), 0);
  const secondTotal = revealed.reduce((sum, front) => sum + calculateFrontPower(state, second.playerId, front.definition.frontId), 0);
  if (firstTotal !== secondTotal) return firstTotal > secondTotal ? first.playerId : second.playerId;
  return state.initiativePlayerId;
}

export function calculateWinner(state: GameState): GameWinner {
  const [first, second] = state.players;
  const frontWinners: Record<string, PlayerId | null> = {};
  const controls = new Map<PlayerId, number>([[first.playerId, 0], [second.playerId, 0]]);
  const totals: Record<PlayerId, number> = { [first.playerId]: 0, [second.playerId]: 0 };
  for (const front of state.fronts) {
    const frontId = front.definition.frontId;
    const winner = frontWinner(state, frontId);
    frontWinners[frontId] = winner;
    if (winner) controls.set(winner, (controls.get(winner) ?? 0) + 1);
    totals[first.playerId] = (totals[first.playerId] ?? 0) + calculateFrontPower(state, first.playerId, frontId);
    totals[second.playerId] = (totals[second.playerId] ?? 0) + calculateFrontPower(state, second.playerId, frontId);
  }
  if ((controls.get(first.playerId) ?? 0) >= 2) return { winnerId: first.playerId, reason: 'fronts', stake: state.stake.current, frontWinners, totals };
  if ((controls.get(second.playerId) ?? 0) >= 2) return { winnerId: second.playerId, reason: 'fronts', stake: state.stake.current, frontWinners, totals };
  if (totals[first.playerId] !== totals[second.playerId]) {
    return { winnerId: (totals[first.playerId] ?? 0) > (totals[second.playerId] ?? 0) ? first.playerId : second.playerId, reason: 'total_power', stake: state.stake.current, frontWinners, totals };
  }
  return { winnerId: null, reason: 'draw', stake: state.stake.current, frontWinners, totals };
}

function revealReverseDeployments(state: GameState): void {
  for (const front of state.fronts.filter((candidate) => candidate.definition.effectId === 'reverse_reveal')) {
    for (const owner of state.players) {
      const hidden = (owner.fronts[front.definition.frontId] ?? [])
        .filter((card) => !card.revealed && card.deployedTurn === state.turn)
        .sort((left, right) => right.instanceId.localeCompare(left.instanceId));
      for (const card of hidden) revealCard(state, owner, card);
    }
  }
}

function runFrontOutcomeTriggers(state: GameState, winner: GameWinner): void {
  for (const front of state.fronts) {
    const frontId = front.definition.frontId;
    const winningPlayerId = winner.frontWinners[frontId];
    if (!winningPlayerId) continue;
    for (const owner of state.players) {
      const trigger: AbilityTrigger = winningPlayerId === owner.playerId ? 'on_front_won' : 'on_front_lost';
      for (const card of [...(owner.fronts[frontId] ?? [])]) {
        if (card.revealed && !card.silenced) runCardTrigger(state, owner, card, card.cardId, trigger, { ...(winningPlayerId ? { playerId: winningPlayerId } : {}), frontId });
      }
    }
  }
}

export function resolveTurn(state: GameState): GameState {
  if (state.phase !== 'planning') throw new RuleError('NOT_PLANNING', 'Turn resolution requires the planning phase.');
  if (!state.players.every((owner) => owner.locked)) throw new RuleError('PLAYERS_NOT_LOCKED', 'Both players must lock before resolution.');
  state.phase = 'resolving';
  const ordered = [
    getPlayer(state, state.initiativePlayerId),
    getOpponent(state, state.initiativePlayerId)
  ];
  appendEvent(state, 'reveal_order', { playerIds: ordered.map((owner) => owner.playerId) });
  for (const owner of ordered) {
    deployCards(state, owner, owner.intent ?? { requestId: `auto-${state.turn}-${owner.playerId}`, turn: state.turn, deployments: [] });
  }
  revealReverseDeployments(state);
  runBoardTrigger(state, 'turn_end');
  resolveAllFrontEffects(state);
  appendEvent(state, 'turn_resolved', { turn: state.turn });
  if (state.turn >= STANDARD_TURNS) {
    runBoardTrigger(state, 'finale');
    runBoardTrigger(state, 'before_scoring');
    const preliminary = calculateWinner(state);
    runFrontOutcomeTriggers(state, preliminary);
    state.winner = calculateWinner(state);
    state.phase = 'ended';
    appendEvent(state, 'game_ended', { winner: state.winner });
    return state;
  }
  state.initiativePlayerId = calculateInitiative(state);
  state.turn += 1;
  beginTurn(state);
  return state;
}

export function lockTurn(state: GameState, playerId: PlayerId, requestId: string): ValidationResult {
  if (state.processedRequestIds.includes(requestId)) return { ok: true };
  const owner = getPlayer(state, playerId);
  if (state.phase !== 'planning') return { ok: false, issues: [{ code: 'NOT_PLANNING', message: 'The game is not accepting locks.' }] };
  if (!owner.intent) {
    const emptyIntent: TurnIntent = { requestId: `${requestId}:empty`, turn: state.turn, deployments: [] };
    const result = submitTurnIntent(state, playerId, emptyIntent);
    if (!result.ok) return result;
  }
  owner.locked = true;
  state.processedRequestIds.push(requestId);
  appendEvent(state, 'turn_locked', { requestId }, { playerId });
  const opponent = getOpponent(state, playerId);
  if (state.stake.pending !== null && state.stake.raisedBy.some((id) => id === opponent.playerId)) {
    appendEvent(state, 'banner_accepted', { playerId, pending: state.stake.pending });
  }
  if (state.players.every((item) => item.locked)) resolveTurn(state);
  return { ok: true };
}

export function raiseBanner(state: GameState, playerId: PlayerId, requestId: string): ValidationResult {
  if (state.processedRequestIds.includes(requestId)) return { ok: true };
  const owner = getPlayer(state, playerId);
  if (state.phase !== 'planning') return { ok: false, issues: [{ code: 'NOT_PLANNING', message: 'A banner can only be raised during planning.' }] };
  if (owner.bannerUsed) return { ok: false, issues: [{ code: 'BANNER_ALREADY_USED', message: 'This player already raised a banner.' }] };
  const base = state.stake.pending ?? state.stake.current;
  if (base >= 8) return { ok: false, issues: [{ code: 'STAKE_MAXIMUM', message: 'Stake is already at its maximum.' }] };
  owner.bannerUsed = true;
  state.stake.raisedBy.push(playerId);
  state.stake.pending = Math.min(8, base * 2) as 2 | 4 | 8;
  state.stake.pendingTurn = state.turn + 1;
  state.processedRequestIds.push(requestId);
  appendEvent(state, 'banner_raised', { requestId, current: state.stake.current, pending: state.stake.pending }, { playerId });
  return { ok: true };
}

export function withdraw(state: GameState, playerId: PlayerId, requestId: string): ValidationResult {
  if (state.processedRequestIds.includes(requestId)) return { ok: true };
  if (state.phase === 'ended') return { ok: false, issues: [{ code: 'GAME_ENDED', message: 'The game has already ended.' }] };
  const owner = getPlayer(state, playerId);
  const winner = getOpponent(state, playerId);
  owner.withdrawn = true;
  state.processedRequestIds.push(requestId);
  const frontWinners = Object.fromEntries(state.fronts.map((front) => [front.definition.frontId, null]));
  const totals: Record<PlayerId, number> = {
    [owner.playerId]: state.fronts.reduce((sum, front) => sum + calculateFrontPower(state, owner.playerId, front.definition.frontId), 0),
    [winner.playerId]: state.fronts.reduce((sum, front) => sum + calculateFrontPower(state, winner.playerId, front.definition.frontId), 0)
  };
  state.winner = { winnerId: winner.playerId, reason: 'withdrawal', stake: state.stake.current, frontWinners, totals };
  state.phase = 'ended';
  appendEvent(state, 'player_withdrew', { requestId, playerId, winnerId: winner.playerId, stake: state.stake.current }, { playerId });
  appendEvent(state, 'game_ended', { winner: state.winner });
  return { ok: true };
}

function cardView(card: CardInstance, canSee: boolean): Partial<CardInstance> & Pick<CardInstance, 'instanceId' | 'ownerId' | 'revealed'> {
  if (canSee) return clone(card);
  return { instanceId: card.instanceId, ownerId: card.ownerId, revealed: false };
}

function hiddenFrontDefinition(index: number): FrontDefinition {
  return {
    frontId: `front-slot-${index + 1}`,
    nameZh: '未揭示战线',
    nameEn: 'Unrevealed Front',
    descriptionZh: '该战线尚未揭示。',
    descriptionEn: 'This front has not been revealed.',
    effectId: 'hidden',
    effectArgs: {},
    enabled: true,
    weight: 1,
    complexity: 'simple',
    categories: ['hidden'],
    minimumClientVersion: PROTOCOL_VERSION,
    packId: 'core',
    tags: ['hidden'],
    strategyZh: '根据未知规则评估投入风险。'
  };
}

function redactHiddenFrontReferences(state: GameState, value: unknown): unknown {
  const replacements = new Map(state.fronts.map((front, index) => [front.definition.frontId, front.revealed ? front.definition.frontId : `front-slot-${index + 1}`]));
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return replacements.get(item) ?? item;
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry)]));
    return item;
  };
  return visit(value);
}

function buildView(state: GameState, perspective?: PlayerId): PlayerView {
  const ended = state.phase === 'ended';
  return {
    protocolVersion: state.protocolVersion,
    gameId: state.gameId,
    turn: state.turn,
    phase: state.phase,
    sequence: state.sequence,
    initiativePlayerId: state.initiativePlayerId,
    ...(state.setup.catalogVersion ? { catalogVersion: state.setup.catalogVersion } : {}),
    fronts: state.fronts.map((front, frontIndex) => {
      const frontId = front.definition.frontId;
      const publicFrontId = front.revealed || ended ? frontId : `front-slot-${frontIndex + 1}`;
      const cards: PlayerView['fronts'][number]['cards'] = {};
      const power: Record<PlayerId, number | null> = {};
      const capacity: Record<PlayerId, number> = {};
      const deploymentBlocked: Record<PlayerId, boolean> = {};
      const movementBlocked: Record<PlayerId, boolean> = {};
      for (const owner of state.players) {
        const concealsLane = front.definition.effectId === 'concealed_lane' && !ended && owner.playerId !== perspective;
        cards[owner.playerId] = (owner.fronts[frontId] ?? []).map((card) => {
          const result = cardView(card, !concealsLane && (ended || owner.playerId === perspective || card.revealed));
          if (!front.revealed && result.frontId) result.frontId = publicFrontId;
          return result;
        });
        const hidesPower = ['hidden_power', 'concealed_lane'].includes(front.definition.effectId) && !ended && owner.playerId !== perspective;
        power[owner.playerId] = front.revealed && !hidesPower ? calculateFrontPower(state, owner.playerId, frontId) : null;
        capacity[owner.playerId] = getFrontCapacity(state, owner.playerId, frontId);
        deploymentBlocked[owner.playerId] = capacity[owner.playerId] === 0;
        movementBlocked[owner.playerId] = front.definition.effectId === 'no_move' || front.movementBlockedFor?.includes(owner.playerId) === true;
      }
      const result: PlayerView['fronts'][number] = { definition: front.revealed || ended ? clone(front.definition) : hiddenFrontDefinition(frontIndex), revealed: front.revealed, cards, power, capacity, deploymentBlocked, movementBlocked };
      if (front.revealedTurn !== undefined) result.revealedTurn = front.revealedTurn;
      return result;
    }),
    players: state.players.map((owner) => {
      const result: PlayerView['players'][number] = {
        playerId: owner.playerId,
        name: owner.name,
        handCount: owner.hand.length,
        deckCount: owner.deck.length,
        graveyardCount: owner.graveyard.length,
        energy: owner.energy,
        locked: owner.locked,
        bannerUsed: owner.bannerUsed,
        withdrawn: owner.withdrawn
      };
      if (perspective === owner.playerId || ended) result.hand = [...owner.hand];
      return result;
    }),
    stake: clone(state.stake),
    winner: clone(state.winner),
    events: state.eventLog.filter((event) => event.public || event.playerId === perspective).map((event) => redactHiddenFrontReferences(state, clone(event)) as GameEvent)
  };
}

export function createPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  getPlayer(state, playerId);
  return buildView(state, playerId);
}

export function createPublicView(state: GameState): PlayerView {
  return buildView(state);
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGame(serialized: string): GameState {
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object') throw new RuleError('INVALID_SERIALIZED_GAME', 'Serialized game must contain an object.');
  const candidate = parsed as Partial<GameState>;
  if (candidate.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(candidate.players) || candidate.players.length !== 2) {
    throw new RuleError('INVALID_SERIALIZED_GAME', 'Serialized game has an invalid protocol or player structure.');
  }
  return candidate as GameState;
}

export function replayGameEvents(source: GameState): GameState {
  const replayed = createGame({ ...clone(source.setup), gameId: source.gameId });
  const actions = source.eventLog.filter((event) => ['turn_submitted', 'turn_undone', 'turn_locked', 'banner_raised', 'player_withdrew'].includes(event.type));
  for (const event of actions) {
    if (!event.playerId || replayed.phase === 'ended') continue;
    if (event.type === 'turn_submitted') {
      submitTurnIntent(replayed, event.playerId, clone(event.payload.intent) as TurnIntent);
    } else if (event.type === 'turn_undone') {
      undoTurnIntent(replayed, event.playerId, asString(event.payload.requestId));
    } else if (event.type === 'turn_locked') {
      lockTurn(replayed, event.playerId, asString(event.payload.requestId));
    } else if (event.type === 'banner_raised') {
      raiseBanner(replayed, event.playerId, asString(event.payload.requestId));
    } else if (event.type === 'player_withdrew') {
      withdraw(replayed, event.playerId, asString(event.payload.requestId));
    }
  }
  return replayed;
}

export function verifyReplay(state: GameState): boolean {
  const replayed = replayGameEvents(state);
  return serializeGame(replayed) === serializeGame(state);
}

export { FRONT_DEFINITIONS };
