import { ABILITY_REGISTRY, resolveAbility } from './abilities.js';
import { FRONT_DEFINITIONS, validateFrontDefinitions } from './fronts.js';
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

const clone = <T>(value: T): T => structuredClone(value);

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
  const found = state.fronts.find((item) => item.definition.frontId === frontId);
  if (!found) throw new RuleError('FRONT_NOT_FOUND', `Front does not exist: ${frontId}`);
  return found;
}

function drawCards(state: GameState, owner: PlayerState, count: number): string[] {
  const drawn = owner.deck.splice(0, Math.max(0, count));
  owner.hand.push(...drawn);
  if (drawn.length > 0) {
    appendEvent(state, 'cards_drawn', { count: drawn.length, cardIds: [...drawn] }, { playerId: owner.playerId, public: false });
    appendEvent(state, 'opponent_drew', { count: drawn.length, playerId: owner.playerId });
  }
  return drawn;
}

function selectFronts(rng: SeededRandom, fronts: readonly FrontDefinition[]): FrontDefinition[] {
  const enabled = fronts.filter((item) => item.enabled && item.weight > 0);
  if (enabled.length < 3) throw new RuleError('INSUFFICIENT_FRONTS', 'At least three fronts must be enabled.');
  const pool = enabled.flatMap((item) => Array.from({ length: Math.max(1, Math.floor(item.weight)) }, () => item));
  const selected: FrontDefinition[] = [];
  while (selected.length < 3) {
    const candidate = rng.pick(pool);
    if (!selected.some((item) => item.frontId === candidate.frontId)) selected.push(clone(candidate));
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
    energy: 1,
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
    setup: {
      seed: options.seed >>> 0,
      cards: clone(options.cards),
      fronts: clone(options.fronts),
      players: clone(options.players)
    }
  };
  state.rngState = rng.getState();
  appendEvent(state, 'game_created', { gameId: state.gameId, seed: state.seed, frontIds });
  for (const owner of state.players) drawCards(state, owner, 3);
  beginTurn(state);
  return state;
}

function revealCard(state: GameState, owner: PlayerState, card: CardInstance): void {
  if (card.revealed) return;
  card.revealed = true;
  appendEvent(state, 'card_revealed', { playerId: owner.playerId, instanceId: card.instanceId, cardId: card.cardId, frontId: card.frontId });
  const definition = state.cardCatalog[card.cardId];
  if (definition?.trigger === 'deploy' && !card.silenced) runAbility(state, owner, card);
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
  const index = Math.min(state.turn - 1, 2);
  const front = state.fronts[index];
  if (front && !front.revealed) {
    front.revealed = true;
    front.revealedTurn = state.turn;
    appendEvent(state, 'front_revealed', { frontId: front.definition.frontId, index });
  }
  if (state.turn >= 2 && state.fronts.some((item) => item.definition.effectId === 'early_reveal')) {
    const third = state.fronts[2];
    if (third && !third.revealed) {
      third.revealed = true;
      third.revealedTurn = state.turn;
      appendEvent(state, 'front_revealed', { frontId: third.definition.frontId, index: 2, early: true });
    }
  }
}

function beginTurn(state: GameState): void {
  state.phase = 'planning';
  applyPendingStake(state);
  revealScheduledFronts(state);
  revealDelayedCards(state);
  for (const owner of state.players) {
    owner.energy = state.turn;
    owner.locked = false;
    delete owner.intent;
    drawCards(state, owner, 1);
  }
  runBoardTrigger(state, 'turn_start');
  state.initiativePlayerId = calculateInitiative(state);
  appendEvent(state, 'turn_started', { turn: state.turn, initiativePlayerId: state.initiativePlayerId, energy: state.turn });
}

export function getEffectiveCost(state: GameState, card: CardDefinition, frontId: string): number {
  const front = getFrontState(state, frontId).definition;
  let result = card.cost;
  if (front.effectId === 'cost_down') result -= asNumber(front.effectArgs?.amount, 1);
  if (front.effectId === 'cost_up') result += asNumber(front.effectArgs?.amount, 1);
  return Math.max(1, Math.floor(result));
}

export function getFrontCapacity(state: GameState, playerId: PlayerId, frontId: string): number {
  const front = getFrontState(state, frontId);
  let capacity = DEFAULT_FRONT_CAPACITY;
  if (front.definition.effectId === 'capacity_up') capacity += asNumber(front.definition.effectArgs?.amount, 1);
  if (front.definition.effectId === 'capacity_down') capacity -= asNumber(front.definition.effectArgs?.amount, 1);
  if (front.blockedFor === playerId) return 0;
  return Math.max(1, Math.floor(capacity));
}

function validateFrontRestriction(front: FrontDefinition, card: CardDefinition): ValidationIssue | null {
  if (front.effectId === 'ban_high_cost' && card.cost >= asNumber(front.effectArgs?.threshold, 4)) {
    return { code: 'HIGH_COST_BLOCKED', message: `${card.nameZh} cannot be deployed to ${front.nameZh}.` };
  }
  if (front.effectId === 'ban_low_cost' && card.cost <= asNumber(front.effectArgs?.threshold, 2)) {
    return { code: 'LOW_COST_BLOCKED', message: `${card.nameZh} cannot be deployed to ${front.nameZh}.` };
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
    const front = state.fronts.find((item) => item.definition.frontId === deployment.frontId);
    if (!front) {
      issues.push({ code: 'UNKNOWN_FRONT', message: `Unknown front: ${deployment.frontId}`, path: `deployments[${index}]` });
      continue;
    }
    const restriction = validateFrontRestriction(front.definition, card);
    if (restriction) issues.push({ ...restriction, path: `deployments[${index}]` });
    totalCost += getEffectiveCost(state, card, deployment.frontId);
    laneAdds.set(deployment.frontId, (laneAdds.get(deployment.frontId) ?? 0) + 1);
  }
  if (totalCost > owner.energy) issues.push({ code: 'INSUFFICIENT_ENERGY', message: `Plan costs ${totalCost}, but only ${owner.energy} military orders are available.` });
  for (const [frontId, additions] of laneAdds) {
    const occupied = owner.fronts[frontId]?.length ?? 0;
    if (occupied + additions > getFrontCapacity(state, playerId, frontId)) {
      issues.push({ code: 'FRONT_CAPACITY', message: `${frontId} does not have enough capacity.` });
    }
  }
  for (const [index, move] of (intent.moves ?? []).entries()) {
    const source = Object.values(owner.fronts).flat().find((card) => card.instanceId === move.instanceId);
    if (!source) issues.push({ code: 'INVALID_MOVE_SOURCE', message: `Card instance is not controlled by player: ${move.instanceId}`, path: `moves[${index}]` });
    if (!state.fronts.some((front) => front.definition.frontId === move.targetFrontId)) {
      issues.push({ code: 'INVALID_MOVE_TARGET', message: `Unknown move target: ${move.targetFrontId}`, path: `moves[${index}]` });
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function submitTurnIntent(state: GameState, playerId: PlayerId, intent: TurnIntent): ValidationResult {
  if (state.processedRequestIds.includes(intent.requestId)) return { ok: true };
  const result = validateTurnIntent(state, playerId, intent);
  if (!result.ok) return result;
  const owner = getPlayer(state, playerId);
  owner.intent = clone(intent);
  state.processedRequestIds.push(intent.requestId);
  appendEvent(state, 'turn_submitted', { intent: clone(intent) }, { playerId, public: false });
  appendEvent(state, 'turn_plan_updated', { playerId, deploymentCount: intent.deployments.length });
  return { ok: true };
}

export function undoTurnIntent(state: GameState, playerId: PlayerId, requestId: string): ValidationResult {
  if (state.processedRequestIds.includes(requestId)) return { ok: true };
  const owner = getPlayer(state, playerId);
  if (owner.locked) return { ok: false, issues: [{ code: 'TURN_LOCKED', message: 'A locked plan cannot be undone.' }] };
  delete owner.intent;
  state.processedRequestIds.push(requestId);
  appendEvent(state, 'turn_undone', { requestId }, { playerId, public: false });
  appendEvent(state, 'turn_plan_updated', { playerId, deploymentCount: 0 });
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
    owner.fronts[sourceFrontId] = owner.fronts[sourceFrontId]!.filter((card) => card.instanceId !== moving?.instanceId);
    moving.frontId = move.targetFrontId;
    target.push(moving);
    appendEvent(state, 'card_moved', { playerId: owner.playerId, instanceId: moving.instanceId, from: sourceFrontId, to: move.targetFrontId });
  }
}

function runAbility(state: GameState, owner: PlayerState, source: CardInstance): void {
  if (source.silenced || !source.revealed) return;
  const events = resolveAbility({
    gameState: state,
    sourceCardId: source.cardId,
    sourceInstanceId: source.instanceId,
    sourcePlayerId: owner.playerId,
    sourceFrontId: source.frontId,
    turn: state.turn,
    eventQueue: [],
    depth: 0
  });
  flushAbilityEvents(state, events);
}

function runBoardTrigger(state: GameState, trigger: AbilityTrigger): void {
  const snapshot = state.players.flatMap((owner) =>
    Object.values(owner.fronts).flatMap((cards) => cards.map((card) => ({ owner, card })))
  );
  for (const { owner, card } of snapshot) {
    const definition = state.cardCatalog[card.cardId];
    if (definition?.trigger === trigger && card.revealed && !card.silenced) runAbility(state, owner, card);
  }
}

function deployCards(state: GameState, owner: PlayerState, intent: TurnIntent): void {
  movePlannedCards(state, owner, intent);
  const sorted = [...intent.deployments].sort((left, right) => left.order - right.order || left.cardId.localeCompare(right.cardId));
  for (const deployment of sorted) {
    const handIndex = owner.hand.indexOf(deployment.cardId);
    if (handIndex < 0) throw new RuleError('CARD_LEFT_HAND', 'A submitted card left the hand before resolution.');
    const definition = state.cardCatalog[deployment.cardId];
    if (!definition) throw new RuleError('UNKNOWN_CARD', `Unknown card: ${deployment.cardId}`);
    const front = getFrontState(state, deployment.frontId);
    owner.hand.splice(handIndex, 1);
    const delayed = definition.abilityId === 'ambush' || front.definition.effectId === 'delayed_reveal';
    const source: CardInstance = {
      instanceId: `${state.gameId}-${state.nextInstanceId}`,
      cardId: definition.cardId,
      ownerId: owner.playerId,
      currentPower: definition.power,
      frontId: deployment.frontId,
      revealed: !delayed,
      silenced: front.definition.effectId === 'silence',
      deployedTurn: state.turn,
      modifiers: []
    };
    state.nextInstanceId += 1;
    owner.fronts[deployment.frontId]?.push(source);
    appendEvent(state, 'card_deployed', {
      playerId: owner.playerId,
      instanceId: source.instanceId,
      cardId: source.revealed ? source.cardId : null,
      frontId: source.frontId,
      revealed: source.revealed
    });
    if (source.revealed && !source.silenced && definition.trigger === 'deploy') {
      runAbility(state, owner, source);
      if (front.definition.effectId === 'repeat_reveal') runAbility(state, owner, source);
    }
  }
}

function moveOneLeft(state: GameState, owner: PlayerState): number {
  for (let index = state.fronts.length - 1; index > 0; index -= 1) {
    const fromId = state.fronts[index]?.definition.frontId;
    const toId = state.fronts[index - 1]?.definition.frontId;
    if (!fromId || !toId) continue;
    const card = owner.fronts[fromId]?.at(-1);
    if (!card || (owner.fronts[toId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, toId)) continue;
    owner.fronts[fromId] = owner.fronts[fromId]!.filter((item) => item.instanceId !== card.instanceId);
    card.frontId = toId;
    owner.fronts[toId]?.push(card);
    appendEvent(state, 'card_moved', { playerId: owner.playerId, instanceId: card.instanceId, from: fromId, to: toId, reason: 'front' });
    return 1;
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
  if (!targetId || (owner.fronts[targetId]?.length ?? 0) >= getFrontCapacity(state, owner.playerId, targetId)) return 0;
  owner.fronts[card.frontId] = owner.fronts[card.frontId]!.filter((item) => item.instanceId !== card.instanceId);
  const fromId = card.frontId;
  card.frontId = targetId;
  owner.fronts[targetId]?.push(card);
  appendEvent(state, 'card_moved', { playerId: owner.playerId, instanceId: card.instanceId, from: fromId, to: targetId, reason: 'front_random' });
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
        const discarded = targets[0]!.hand.shift();
        appendEvent(state, 'card_discarded', { playerId: targets[0]!.playerId, cardId: discarded ?? null, reason: 'front' });
        changed += discarded ? 1 : 0;
      }
      break;
    }
    case 'destroy': {
      const candidates = state.players.flatMap((owner) =>
        (owner.fronts[frontId] ?? []).filter((card) => card.revealed).map((card) => ({ owner, card }))
      );
      const victim = candidates.sort((left, right) => left.card.currentPower - right.card.currentPower || left.card.instanceId.localeCompare(right.card.instanceId))[0];
      if (victim) {
        victim.owner.fronts[frontId] = victim.owner.fronts[frontId]!.filter((card) => card.instanceId !== victim.card.instanceId);
        victim.owner.graveyard.push(victim.card);
        appendEvent(state, 'card_destroyed', { playerId: victim.owner.playerId, instanceId: victim.card.instanceId, reason: 'front' });
        changed = 1;
      }
      break;
    }
    case 'return':
      for (const owner of state.players) {
        const restored = owner.graveyard.shift();
        if (restored) {
          owner.hand.push(restored.cardId);
          appendEvent(state, 'card_returned', { playerId: owner.playerId, cardId: restored.cardId, reason: 'front' });
          changed += 1;
        }
      }
      break;
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
  const lane = owner.fronts[frontId] ?? [];
  const front = getFrontState(state, frontId).definition;
  let total = lane.reduce((sum, card) => sum + card.currentPower, 0);
  for (const card of lane) {
    const definition = state.cardCatalog[card.cardId];
    if (!definition) continue;
    if (!card.silenced && definition.abilityId === 'ongoing_allies') total += Math.max(0, lane.length - 1);
    if (!card.silenced && definition.abilityId === 'command_aura') total += Math.max(0, lane.length - 1);
    if (!card.silenced && definition.abilityId === 'lone_warrior' && lane.length === 1) total += 3;
    if (!card.silenced && definition.abilityId === 'synergy_tag') {
      total += lane.filter((ally) => ally.instanceId !== card.instanceId && state.cardCatalog[ally.cardId]?.tags.some((tag) => definition.tags.includes(tag))).length;
    }
  }
  const value = asNumber(front.effectArgs?.amount, 0);
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
    case 'vanilla_bonus': total += lane.filter((card) => card.silenced || !ABILITY_REGISTRY.has(state.cardCatalog[card.cardId]?.abilityId ?? '')).length * value; break;
    case 'solo_bonus': if (lane.length === 1) total += value; break;
    case 'full_bonus': if (lane.length >= getFrontCapacity(state, playerId, frontId)) total += value; break;
    case 'cross_era_bonus': total += new Set(lane.map((card) => state.cardCatalog[card.cardId]?.era).filter(Boolean)).size * value; break;
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
  runBoardTrigger(state, 'turn_end');
  resolveAllFrontEffects(state);
  appendEvent(state, 'turn_resolved', { turn: state.turn });
  if (state.turn >= STANDARD_TURNS) {
    runBoardTrigger(state, 'finale');
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

function buildView(state: GameState, perspective?: PlayerId): PlayerView {
  const ended = state.phase === 'ended';
  return {
    protocolVersion: state.protocolVersion,
    gameId: state.gameId,
    turn: state.turn,
    phase: state.phase,
    sequence: state.sequence,
    initiativePlayerId: state.initiativePlayerId,
    fronts: state.fronts.map((front) => {
      const frontId = front.definition.frontId;
      const cards: PlayerView['fronts'][number]['cards'] = {};
      const power: Record<PlayerId, number | null> = {};
      for (const owner of state.players) {
        cards[owner.playerId] = (owner.fronts[frontId] ?? []).map((card) => cardView(card, ended || owner.playerId === perspective || card.revealed));
        const hidesPower = front.definition.effectId === 'hidden_power' && !ended && owner.playerId !== perspective;
        power[owner.playerId] = front.revealed && !hidesPower ? calculateFrontPower(state, owner.playerId, frontId) : null;
      }
      const result: PlayerView['fronts'][number] = { definition: clone(front.definition), revealed: front.revealed, cards, power };
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
    events: state.eventLog.filter((event) => event.public || event.playerId === perspective).map(clone)
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
