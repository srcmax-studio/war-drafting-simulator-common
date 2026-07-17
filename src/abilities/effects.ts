import { SeededRandom } from '../rng.js';
import {
  MAX_ABILITY_REPEATS,
  type AbilityContext,
  type AtomicEffectType,
  type CardInstance,
  type EffectSpec,
  type FrontState,
  type PlayerState
} from '../types.js';
import { selectTargets } from './selectors.js';
import { emit, ensureInstanceState, ensurePlayerState, findInstance, ownerOf, type AbilityTarget } from './runtime.js';

export interface EffectRuntime {
  context: AbilityContext;
  effect: EffectSpec;
  targets: AbilityTarget[];
  repeat: (times: number) => void;
}

export type EffectHandler = (runtime: EffectRuntime) => number;

const numeric = (effect: EffectSpec, fallback = 1): number =>
  typeof effect.amount === 'number' && Number.isFinite(effect.amount) ? effect.amount : fallback;

const cardsOf = (targets: AbilityTarget[]): Array<{ owner: PlayerState; card: CardInstance }> =>
  targets.filter((target): target is Extract<AbilityTarget, { kind: 'card' }> => target.kind === 'card');

const playersOf = (runtime: EffectRuntime): PlayerState[] => {
  const selected = runtime.targets.filter((target): target is Extract<AbilityTarget, { kind: 'player' }> => target.kind === 'player').map((target) => target.player);
  return selected.length > 0 ? selected : [ownerOf(runtime.context)];
};

const frontsOf = (runtime: EffectRuntime): FrontState[] => {
  const selected = runtime.targets.filter((target): target is Extract<AbilityTarget, { kind: 'front' }> => target.kind === 'front').map((target) => target.front);
  if (selected.length > 0) return selected;
  const source = runtime.context.gameState.fronts.find((front) => front.definition.frontId === runtime.context.sourceFrontId);
  return source ? [source] : [];
};

const capacityOf = (front: FrontState, playerId: string): number => {
  const base = front.definition.effectId === 'capacity_up' ? 5 : front.definition.effectId === 'capacity_down' ? 3 : 4;
  return Math.max(1, base + (front.capacityModifiers?.[playerId] ?? 0));
};

const addPower: EffectHandler = ({ context, effect, targets }) => {
  const value = numeric(effect);
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    card.currentPower += value;
    card.modifiers.push({ source: context.ability.abilityId, amount: value });
    changed += 1;
  }
  return changed;
};

const reducePower: EffectHandler = ({ context, effect, targets }) => {
  const value = Math.abs(numeric(effect));
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    if (card.statuses?.includes('immune')) continue;
    card.currentPower -= value;
    card.modifiers.push({ source: context.ability.abilityId, amount: -value });
    changed += 1;
  }
  return changed;
};

const setPower: EffectHandler = ({ context, effect, targets }) => {
  const value = Number(effect.value ?? effect.amount ?? 0);
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    if (!Number.isFinite(value) || card.statuses?.includes('immune')) continue;
    const delta = value - card.currentPower;
    card.currentPower = value;
    card.modifiers.push({ source: context.ability.abilityId, amount: delta });
    changed += 1;
  }
  return changed;
};

const swapPower: EffectHandler = ({ targets }) => {
  const cards = cardsOf(targets);
  if (cards.length < 2) return 0;
  [cards[0]!.card.currentPower, cards[1]!.card.currentPower] = [cards[1]!.card.currentPower, cards[0]!.card.currentPower];
  return 2;
};

const copyPower: EffectHandler = ({ context, targets }) => {
  const cards = cardsOf(targets);
  if (cards.length === 1) {
    const source = findInstance(context)?.card;
    if (!source) return 0;
    source.currentPower = cards[0]!.card.currentPower;
    return 1;
  }
  if (cards.length < 2) return 0;
  cards[0]!.card.currentPower = cards[1]!.card.currentPower;
  return 1;
};

const temporaryPower: EffectHandler = ({ context, effect, targets }) => {
  const value = numeric(effect);
  const expiresTurn = typeof effect.duration === 'number' ? context.turn + effect.duration : context.turn;
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    card.currentPower += value;
    card.modifiers.push({ source: context.ability.abilityId, amount: value, expiresTurn });
    changed += 1;
  }
  return changed;
};

const changeCost = (mode: 'add' | 'reduce' | 'set'): EffectHandler => ({ context, effect, targets }) => {
  const value = Math.abs(numeric(effect));
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    ensureInstanceState(card);
    const base = context.gameState.cardCatalog[card.cardId]?.cost ?? 1;
    const current = card.currentCost || base;
    card.currentCost = Math.max(1, Math.floor(mode === 'add' ? current + value : mode === 'reduce' ? current - value : Number(effect.value ?? value)));
    changed += 1;
  }
  return changed;
};

const drawCards: EffectHandler = (runtime) => {
  const count = Math.max(0, Math.floor(numeric(runtime.effect)));
  let changed = 0;
  for (const player of playersOf(runtime)) {
    ensurePlayerState(player);
    const drawn = player.deck.splice(0, count);
    player.hand.push(...drawn);
    player.counters!.cardsDrawn += drawn.length;
    if (drawn.length > 0) {
      emit(runtime.context, 'cards_drawn', { count: drawn.length, cardIds: drawn }, { public: false, playerId: player.playerId });
      emit(runtime.context, 'opponent_drew', { count: drawn.length, playerId: player.playerId });
    }
    changed += drawn.length;
  }
  return changed;
};

const createToken: EffectHandler = ({ context, effect }) => {
  const owner = ownerOf(context);
  const cardId = effect.tokenId ?? effect.cardId;
  if (!cardId || !context.gameState.cardCatalog[cardId]) return 0;
  const count = Math.max(1, Math.floor(numeric(effect)));
  owner.hand.push(...Array.from({ length: count }, () => cardId));
  return count;
};

const copyCard: EffectHandler = ({ context, targets, effect }) => {
  const owner = ownerOf(context);
  const copies = targets.flatMap((target) => {
    if (target.kind === 'card') return [target.card.cardId];
    if (target.kind === 'card_id') return [target.cardId];
    return [];
  }).slice(0, Math.max(1, Math.floor(numeric(effect))));
  owner.hand.push(...copies);
  return copies.length;
};

const transformCard: EffectHandler = ({ context, effect, targets }) => {
  if (!effect.cardId || !context.gameState.cardCatalog[effect.cardId]) return 0;
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    card.cardId = effect.cardId;
    card.currentPower = context.gameState.cardCatalog[effect.cardId]!.power;
    card.currentCost = context.gameState.cardCatalog[effect.cardId]!.cost;
    changed += 1;
  }
  return changed;
};

const discardCards: EffectHandler = (runtime) => {
  const count = Math.max(1, Math.floor(numeric(runtime.effect)));
  const explicit = runtime.targets.filter((target): target is Extract<AbilityTarget, { kind: 'card_id' }> => target.kind === 'card_id' && target.zone === 'hand');
  const players = explicit.length > 0 ? [...new Set(explicit.map((target) => target.owner))] : playersOf(runtime);
  let changed = 0;
  for (const player of players) {
    ensurePlayerState(player);
    const selectedIds = explicit.filter((target) => target.owner === player).map((target) => target.cardId);
    const discarded = (selectedIds.length > 0 ? selectedIds : player.hand.slice(0, count)).slice(0, count);
    for (const cardId of discarded) {
      const index = player.hand.indexOf(cardId);
      if (index < 0) continue;
      player.hand.splice(index, 1);
      player.discarded!.push(cardId);
      player.counters!.discards += 1;
      emit(runtime.context, 'card_discarded', { playerId: player.playerId, cardId });
      changed += 1;
    }
  }
  return changed;
};

const destroyCards: EffectHandler = ({ context, targets }) => {
  let changed = 0;
  for (const { owner, card } of cardsOf(targets)) {
    ensureInstanceState(card);
    if (card.statuses!.includes('immune') || card.statuses!.includes('protected')) continue;
    const lane = owner.fronts[card.frontId] ?? [];
    if (!lane.some((candidate) => candidate.instanceId === card.instanceId)) continue;
    owner.fronts[card.frontId] = lane.filter((candidate) => candidate.instanceId !== card.instanceId);
    owner.graveyard.push(card);
    ensurePlayerState(owner);
    owner.counters!.deaths += 1;
    emit(context, 'card_destroyed', { playerId: owner.playerId, instanceId: card.instanceId, cardId: card.cardId });
    changed += 1;
  }
  return changed;
};

const reviveCard: EffectHandler = ({ context, targets }) => {
  const frontId = context.sourceFrontId;
  if (!frontId) return 0;
  const front = context.gameState.fronts.find((candidate) => candidate.definition.frontId === frontId);
  if (!front) return 0;
  let changed = 0;
  for (const { owner, card } of cardsOf(targets)) {
    if (!owner.graveyard.some((candidate) => candidate.instanceId === card.instanceId)) continue;
    if ((owner.fronts[frontId]?.length ?? 0) >= capacityOf(front, owner.playerId)) continue;
    owner.graveyard = owner.graveyard.filter((candidate) => candidate.instanceId !== card.instanceId);
    card.frontId = frontId;
    card.revealed = true;
    card.createdByEffect = true;
    owner.fronts[frontId]!.push(card);
    changed += 1;
  }
  return changed;
};

const returnToHand: EffectHandler = ({ context, targets }) => {
  let changed = 0;
  for (const { owner, card } of cardsOf(targets)) {
    const inGraveyard = owner.graveyard.some((candidate) => candidate.instanceId === card.instanceId);
    if (inGraveyard) owner.graveyard = owner.graveyard.filter((candidate) => candidate.instanceId !== card.instanceId);
    else owner.fronts[card.frontId] = (owner.fronts[card.frontId] ?? []).filter((candidate) => candidate.instanceId !== card.instanceId);
    owner.hand.push(card.cardId);
    emit(context, 'card_returned', { playerId: owner.playerId, cardId: card.cardId, instanceId: card.instanceId });
    changed += 1;
  }
  return changed;
};

const shuffleIntoDeck: EffectHandler = ({ context, targets }) => {
  const rng = SeededRandom.fromState(context.gameState.rngState);
  let changed = 0;
  for (const target of targets) {
    let cardId: string | undefined;
    let owner: PlayerState | undefined;
    if (target.kind === 'card') {
      ({ owner } = target);
      cardId = target.card.cardId;
      owner.graveyard = owner.graveyard.filter((candidate) => candidate.instanceId !== target.card.instanceId);
      owner.fronts[target.card.frontId] = (owner.fronts[target.card.frontId] ?? []).filter((candidate) => candidate.instanceId !== target.card.instanceId);
    } else if (target.kind === 'card_id') {
      ({ owner, cardId } = target);
      const zone = target.zone === 'hand' ? owner.hand : target.zone === 'discard' ? owner.discarded ?? [] : owner.deck;
      const index = zone.indexOf(cardId);
      if (index >= 0) zone.splice(index, 1);
    }
    if (!owner || !cardId) continue;
    owner.deck.splice(rng.int(owner.deck.length + 1), 0, cardId);
    changed += 1;
  }
  context.gameState.rngState = rng.getState();
  return changed;
};

function destinationFront(runtime: EffectRuntime, owner: PlayerState, card: CardInstance, rng: SeededRandom): string | undefined {
  const fronts = runtime.context.gameState.fronts;
  const index = fronts.findIndex((front) => front.definition.frontId === card.frontId);
  const ids = fronts.map((front) => front.definition.frontId);
  const destination = runtime.effect.destination ?? 'adjacent';
  if (destination === 'source_front') return runtime.context.sourceFrontId;
  if (destination === 'left') return ids[index - 1];
  if (destination === 'right') return ids[index + 1];
  if (destination === 'adjacent') {
    const candidates = [ids[index - 1], ids[index + 1]].filter((value): value is string => Boolean(value));
    return candidates.length > 0 ? candidates[rng.int(candidates.length)] : undefined;
  }
  const scored = ids.map((frontId) => ({ frontId, power: (owner.fronts[frontId] ?? []).reduce((sum, candidate) => sum + candidate.currentPower, 0) }))
    .filter((candidate) => candidate.frontId !== card.frontId);
  if (destination === 'weakest_front') return scored.sort((a, b) => a.power - b.power || a.frontId.localeCompare(b.frontId))[0]?.frontId;
  if (destination === 'strongest_front') return scored.sort((a, b) => b.power - a.power || a.frontId.localeCompare(b.frontId))[0]?.frontId;
  return scored.length > 0 ? scored[rng.int(scored.length)]?.frontId : undefined;
}

const moveCard: EffectHandler = (runtime) => {
  const rng = SeededRandom.fromState(runtime.context.gameState.rngState);
  let changed = 0;
  for (const { owner, card } of cardsOf(runtime.targets)) {
    const targetId = destinationFront(runtime, owner, card, rng);
    if (!targetId || targetId === card.frontId) continue;
    const targetFront = runtime.context.gameState.fronts.find((front) => front.definition.frontId === targetId);
    if (!targetFront || targetFront.movementBlockedFor?.includes(owner.playerId)) continue;
    if ((owner.fronts[targetId]?.length ?? 0) >= capacityOf(targetFront, owner.playerId)) continue;
    const fromId = card.frontId;
    owner.fronts[fromId] = (owner.fronts[fromId] ?? []).filter((candidate) => candidate.instanceId !== card.instanceId);
    card.frontId = targetId;
    card.moved = true;
    owner.fronts[targetId]!.push(card);
    ensurePlayerState(owner);
    owner.counters!.moves += 1;
    emit(runtime.context, 'card_moved', { playerId: owner.playerId, instanceId: card.instanceId, from: fromId, to: targetId, reason: 'ability' });
    changed += 1;
  }
  runtime.context.gameState.rngState = rng.getState();
  return changed;
};

const swapPositions: EffectHandler = ({ context, targets }) => {
  const cards = cardsOf(targets);
  if (cards.length < 2) return 0;
  const first = cards[0]!;
  const second = cards[1]!;
  if (first.owner.playerId !== second.owner.playerId || first.card.frontId === second.card.frontId) return 0;
  const firstFront = first.card.frontId;
  const secondFront = second.card.frontId;
  first.owner.fronts[firstFront] = first.owner.fronts[firstFront]!.filter((card) => card.instanceId !== first.card.instanceId);
  first.owner.fronts[secondFront] = first.owner.fronts[secondFront]!.filter((card) => card.instanceId !== second.card.instanceId);
  first.card.frontId = secondFront;
  second.card.frontId = firstFront;
  first.owner.fronts[firstFront]!.push(second.card);
  first.owner.fronts[secondFront]!.push(first.card);
  emit(context, 'formation_changed', { firstInstanceId: first.card.instanceId, secondInstanceId: second.card.instanceId });
  return 2;
};

const randomizePosition: EffectHandler = (runtime) => {
  const original = runtime.effect.destination;
  runtime.effect.destination = 'random_front';
  const changed = moveCard(runtime);
  if (original === undefined) delete runtime.effect.destination;
  else runtime.effect.destination = original;
  return changed;
};

const blockFront = (kind: 'deploy' | 'move'): EffectHandler => (runtime) => {
  const opponentId = runtime.context.gameState.players.find((player) => player.playerId !== runtime.context.sourcePlayerId)?.playerId;
  if (!opponentId) return 0;
  let changed = 0;
  for (const front of frontsOf(runtime)) {
    if (kind === 'deploy') {
      const blocked = Array.isArray(front.blockedFor) ? front.blockedFor : front.blockedFor ? [front.blockedFor] : [];
      front.blockedFor = [...new Set([...blocked, opponentId])];
    } else {
      front.movementBlockedFor = [...new Set([...(front.movementBlockedFor ?? []), opponentId])];
    }
    changed += 1;
  }
  return changed;
};

const addStatus = (status: string): EffectHandler => ({ effect, targets }) => {
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    ensureInstanceState(card);
    const value = effect.status ?? status;
    if (!card.statuses!.includes(value)) card.statuses!.push(value);
    if (value === 'silenced') card.silenced = true;
    changed += 1;
  }
  return changed;
};

const delayReveal: EffectHandler = ({ targets }) => {
  let changed = 0;
  for (const { card } of cardsOf(targets)) { card.revealed = false; changed += 1; }
  return changed;
};

const revealNow: EffectHandler = ({ targets }) => {
  let changed = 0;
  for (const { card } of cardsOf(targets)) { if (!card.revealed) changed += 1; card.revealed = true; }
  return changed;
};

const repeatAbility: EffectHandler = ({ effect, repeat }) => {
  const times = Math.min(MAX_ABILITY_REPEATS, Math.max(1, Math.floor(numeric(effect))));
  repeat(times);
  return times;
};

const removeOngoing: EffectHandler = ({ targets }) => {
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    ensureInstanceState(card);
    if (!card.statuses!.includes('ongoing_removed')) card.statuses!.push('ongoing_removed');
    changed += 1;
  }
  return changed;
};

const changeCapacity = (direction: 1 | -1): EffectHandler => (runtime) => {
  const value = Math.max(1, Math.floor(numeric(runtime.effect))) * direction;
  let changed = 0;
  for (const front of frontsOf(runtime)) {
    front.capacityModifiers ??= {};
    const targetPlayers = runtime.effect.target?.side === 'opponent'
      ? runtime.context.gameState.players.filter((player) => player.playerId !== runtime.context.sourcePlayerId)
      : runtime.context.gameState.players.filter((player) => player.playerId === runtime.context.sourcePlayerId);
    for (const player of targetPlayers) front.capacityModifiers[player.playerId] = (front.capacityModifiers[player.playerId] ?? 0) + value;
    changed += targetPlayers.length;
  }
  return changed;
};

const changeEnergy = (direction: 1 | -1): EffectHandler => (runtime) => {
  const value = Math.max(1, Math.floor(numeric(runtime.effect))) * direction;
  let changed = 0;
  for (const player of playersOf(runtime)) {
    player.energy = Math.max(0, player.energy + value);
    changed += 1;
  }
  return changed;
};

const storeEnergy: EffectHandler = (runtime) => {
  let changed = 0;
  for (const player of playersOf(runtime)) {
    ensurePlayerState(player);
    const value = Math.min(player.energy, Math.max(0, Math.floor(numeric(runtime.effect, player.energy))));
    player.energy -= value;
    player.storedEnergy! += value;
    changed += value;
  }
  return changed;
};

const markerEffect = (direction: 1 | -1): EffectHandler => ({ effect, targets }) => {
  const marker = effect.marker ?? 'momentum';
  const value = Math.max(1, Math.floor(numeric(effect))) * direction;
  let changed = 0;
  for (const { card } of cardsOf(targets)) {
    ensureInstanceState(card);
    const before = card.markers![marker] ?? 0;
    card.markers![marker] = Math.max(0, before + value);
    changed += Math.abs(card.markers![marker] - before);
  }
  return changed;
};

const seizeInitiative: EffectHandler = ({ context }) => {
  context.gameState.initiativePlayerId = context.sourcePlayerId;
  return 1;
};

const changeStake: EffectHandler = ({ context, effect }) => {
  const desired = Math.max(1, Math.min(8, Number(effect.value ?? context.gameState.stake.current + numeric(effect))));
  context.gameState.stake.current = ([1, 2, 4, 8].sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0] ?? 1) as 1 | 2 | 4 | 8;
  return 1;
};

const scaledPower = (valueOf: (runtime: EffectRuntime) => number): EffectHandler => (runtime) => {
  const raw = valueOf(runtime) * (runtime.effect.multiplier ?? numeric(runtime.effect));
  const value = Math.max(runtime.effect.minimum ?? -Infinity, Math.min(runtime.effect.maximum ?? Infinity, raw));
  return addPower({ ...runtime, effect: { ...runtime.effect, amount: value } });
};

const historyPower = scaledPower((runtime) => {
  const owner = ownerOf(runtime.context);
  ensurePlayerState(owner);
  return owner.counters?.[runtime.effect.counter ?? 'deployments'] ?? 0;
});

const otherFrontPower = scaledPower((runtime) => {
  const owner = ownerOf(runtime.context);
  return Object.entries(owner.fronts)
    .filter(([frontId]) => frontId !== runtime.context.sourceFrontId)
    .flatMap(([, cards]) => cards)
    .reduce((sum, card) => sum + card.currentPower, 0);
});

const deckCompositionPower = scaledPower((runtime) => {
  const owner = ownerOf(runtime.context);
  const tag = runtime.effect.tag ?? '';
  return owner.deck.filter((cardId) => runtime.context.gameState.cardCatalog[cardId]?.tags.includes(tag)).length;
});

export const EFFECT_HANDLERS: ReadonlyMap<AtomicEffectType, EffectHandler> = new Map<AtomicEffectType, EffectHandler>([
  ['add_power', addPower],
  ['reduce_power', reducePower],
  ['set_power', setPower],
  ['swap_power', swapPower],
  ['copy_power', copyPower],
  ['temporary_power', temporaryPower],
  ['permanent_power', addPower],
  ['add_cost', changeCost('add')],
  ['reduce_cost', changeCost('reduce')],
  ['set_cost', changeCost('set')],
  ['draw_cards', drawCards],
  ['create_token', createToken],
  ['copy_card', copyCard],
  ['transform_card', transformCard],
  ['discard_cards', discardCards],
  ['destroy_cards', destroyCards],
  ['revive_card', reviveCard],
  ['return_to_hand', returnToHand],
  ['shuffle_into_deck', shuffleIntoDeck],
  ['move_card', moveCard],
  ['swap_positions', swapPositions],
  ['randomize_position', randomizePosition],
  ['block_deploy', blockFront('deploy')],
  ['block_move', blockFront('move')],
  ['silence', addStatus('silenced')],
  ['protect', addStatus('protected')],
  ['immune', addStatus('immune')],
  ['delay_reveal', delayReveal],
  ['reveal_now', revealNow],
  ['repeat_ability', repeatAbility],
  ['remove_ongoing', removeOngoing],
  ['increase_capacity', changeCapacity(1)],
  ['decrease_capacity', changeCapacity(-1)],
  ['gain_energy', changeEnergy(1)],
  ['lose_energy', changeEnergy(-1)],
  ['store_energy', storeEnergy],
  ['consume_marker', markerEffect(-1)],
  ['add_marker', markerEffect(1)],
  ['seize_initiative', seizeInitiative],
  ['change_stake', changeStake],
  ['history_power', historyPower],
  ['other_front_power', otherFrontPower],
  ['deck_composition_power', deckCompositionPower],
  ['set_status', addStatus('marked')]
]);

export const ATOMIC_EFFECT_TYPES: AtomicEffectType[] = [...EFFECT_HANDLERS.keys()];

export function applyEffect(runtime: EffectRuntime): number {
  const targets = runtime.effect.target ? selectTargets(runtime.context, runtime.effect.target) : runtime.targets;
  const handler = EFFECT_HANDLERS.get(runtime.effect.type);
  if (!handler) return 0;
  const changed = handler({ ...runtime, targets });
  emit(runtime.context, 'ability_effect_resolved', { effectType: runtime.effect.type, changed });
  return changed;
}
