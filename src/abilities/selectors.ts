import { SeededRandom } from '../rng.js';
import type { AbilityContext, CardDefinition, TargetFilter, TargetSelector, TargetSelectorType } from '../types.js';
import { compare, findInstance, opponentOf, ownerOf, targetKey, type AbilityTarget } from './runtime.js';

export const TARGET_SELECTOR_TYPES: TargetSelectorType[] = [
  'self', 'source_front', 'owner', 'opponent', 'same_front_allies', 'same_front_enemies', 'adjacent_front_allies',
  'adjacent_front_enemies', 'all_allies', 'all_enemies', 'strongest_card', 'weakest_card', 'highest_cost_card',
  'lowest_cost_card', 'random_legal_card', 'owner_hand', 'opponent_hand', 'owner_deck_top', 'owner_deck_random',
  'owner_graveyard', 'owner_discard', 'matching_tag', 'matching_era', 'matching_region', 'unrevealed_cards',
  'moved_cards', 'deployed_this_turn', 'all_fronts'
];

function cardDefinition(context: AbilityContext, target: AbilityTarget): CardDefinition | undefined {
  if (target.kind === 'card') return context.gameState.cardCatalog[target.card.cardId];
  if (target.kind === 'card_id') return context.gameState.cardCatalog[target.cardId];
  return undefined;
}

function filterValue(context: AbilityContext, target: AbilityTarget, filter: TargetFilter): unknown {
  const definition = cardDefinition(context, target);
  const instance = target.kind === 'card' ? target.card : undefined;
  switch (filter.field) {
    case 'cost': return instance?.currentCost || definition?.cost;
    case 'base_power': return definition?.power;
    case 'current_power': return instance?.currentPower ?? definition?.power;
    case 'era': return definition?.era;
    case 'region': return definition?.region;
    case 'profession': return definition?.profession;
    case 'identity': return definition?.identity;
    case 'faction': return definition?.faction;
    case 'tag': return definition?.tags ?? [];
    case 'revealed': return instance?.revealed ?? false;
    case 'token': return definition?.token === true;
  }
}

function boardTargets(context: AbilityContext, playerIds: string[], frontIds?: string[]): AbilityTarget[] {
  return context.gameState.players
    .filter((player) => playerIds.includes(player.playerId))
    .flatMap((owner) => Object.entries(owner.fronts)
      .filter(([frontId]) => !frontIds || frontIds.includes(frontId))
      .flatMap(([, cards]) => cards.map((card) => ({ kind: 'card' as const, owner, card }))));
}

function adjacentFrontIds(context: AbilityContext): string[] {
  const index = context.gameState.fronts.findIndex((front) => front.definition.frontId === context.sourceFrontId);
  return [index - 1, index + 1]
    .filter((candidate) => candidate >= 0 && candidate < context.gameState.fronts.length)
    .map((candidate) => context.gameState.fronts[candidate]!.definition.frontId);
}

function scopedBoard(context: AbilityContext, selector: TargetSelector): AbilityTarget[] {
  const owner = ownerOf(context);
  const opponent = opponentOf(context);
  const playerIds = selector.side === 'opponent' ? [opponent.playerId]
    : selector.side === 'both' ? [owner.playerId, opponent.playerId]
      : [owner.playerId];
  const frontIds = selector.scope === 'source_front' ? [context.sourceFrontId ?? '']
    : selector.scope === 'adjacent_fronts' ? adjacentFrontIds(context)
      : undefined;
  return boardTargets(context, playerIds, frontIds);
}

function zoneTargets(owner: ReturnType<typeof ownerOf>, zone: 'hand' | 'deck' | 'discard'): Array<Extract<AbilityTarget, { kind: 'card_id' }>> {
  const cards = zone === 'hand' ? owner.hand : zone === 'deck' ? owner.deck : (owner.discarded ?? []);
  return cards.map((cardId, index) => ({ kind: 'card_id' as const, owner, zone, cardId, index }));
}

function defaultCount(type: TargetSelectorType, available: number): number {
  if (['strongest_card', 'weakest_card', 'highest_cost_card', 'lowest_cost_card', 'random_legal_card', 'owner_deck_top', 'owner_deck_random'].includes(type)) return 1;
  if (['owner_hand', 'opponent_hand', 'owner_graveyard', 'owner_discard'].includes(type)) return 1;
  return available;
}

export function selectTargets(context: AbilityContext, selector: TargetSelector = context.ability.target): AbilityTarget[] {
  const owner = ownerOf(context);
  const opponent = opponentOf(context);
  const source = findInstance(context);
  let targets: AbilityTarget[] = [];
  switch (selector.type) {
    case 'self':
      if (source) targets = [{ kind: 'card', owner: source.owner, card: source.card }];
      else targets = zoneTargets(owner, 'hand').filter((target) => target.cardId === context.sourceCardId).slice(0, 1);
      break;
    case 'source_front': {
      const front = context.gameState.fronts.find((candidate) => candidate.definition.frontId === context.sourceFrontId);
      if (front) targets = [{ kind: 'front', front }];
      break;
    }
    case 'owner': targets = [{ kind: 'player', player: owner }]; break;
    case 'opponent': targets = [{ kind: 'player', player: opponent }]; break;
    case 'same_front_allies': targets = boardTargets(context, [owner.playerId], [context.sourceFrontId ?? '']); break;
    case 'same_front_enemies': targets = boardTargets(context, [opponent.playerId], [context.sourceFrontId ?? '']); break;
    case 'adjacent_front_allies': targets = boardTargets(context, [owner.playerId], adjacentFrontIds(context)); break;
    case 'adjacent_front_enemies': targets = boardTargets(context, [opponent.playerId], adjacentFrontIds(context)); break;
    case 'all_allies': targets = boardTargets(context, [owner.playerId]); break;
    case 'all_enemies': targets = boardTargets(context, [opponent.playerId]); break;
    case 'strongest_card': targets = scopedBoard(context, selector).sort((a, b) => (b.kind === 'card' ? b.card.currentPower : 0) - (a.kind === 'card' ? a.card.currentPower : 0) || targetKey(a).localeCompare(targetKey(b))); break;
    case 'weakest_card': targets = scopedBoard(context, selector).sort((a, b) => (a.kind === 'card' ? a.card.currentPower : 0) - (b.kind === 'card' ? b.card.currentPower : 0) || targetKey(a).localeCompare(targetKey(b))); break;
    case 'highest_cost_card': targets = scopedBoard(context, selector).sort((a, b) => (cardDefinition(context, b)?.cost ?? 0) - (cardDefinition(context, a)?.cost ?? 0) || targetKey(a).localeCompare(targetKey(b))); break;
    case 'lowest_cost_card': targets = scopedBoard(context, selector).sort((a, b) => (cardDefinition(context, a)?.cost ?? 0) - (cardDefinition(context, b)?.cost ?? 0) || targetKey(a).localeCompare(targetKey(b))); break;
    case 'random_legal_card': targets = scopedBoard(context, selector); selector = { ...selector, random: true, count: selector.count ?? 1 }; break;
    case 'owner_hand': targets = zoneTargets(owner, 'hand'); break;
    case 'opponent_hand': targets = zoneTargets(opponent, 'hand'); break;
    case 'owner_deck_top': targets = zoneTargets(owner, 'deck'); break;
    case 'owner_deck_random': targets = zoneTargets(owner, 'deck'); selector = { ...selector, random: true, count: selector.count ?? 1 }; break;
    case 'owner_graveyard': targets = owner.graveyard.map((card) => ({ kind: 'card' as const, owner, card })); break;
    case 'owner_discard': targets = zoneTargets(owner, 'discard'); break;
    case 'matching_tag': targets = scopedBoard(context, selector).filter((target) => cardDefinition(context, target)?.tags.includes(selector.tag ?? '') === true); break;
    case 'matching_era': targets = scopedBoard(context, selector).filter((target) => cardDefinition(context, target)?.era === selector.era); break;
    case 'matching_region': targets = scopedBoard(context, selector).filter((target) => cardDefinition(context, target)?.region === selector.region); break;
    case 'unrevealed_cards': targets = scopedBoard(context, { ...selector, side: selector.side ?? 'both' }).filter((target) => target.kind === 'card' && !target.card.revealed); break;
    case 'moved_cards': targets = scopedBoard(context, selector).filter((target) => target.kind === 'card' && target.card.moved); break;
    case 'deployed_this_turn': targets = scopedBoard(context, selector).filter((target) => target.kind === 'card' && target.card.deployedTurn === context.turn); break;
    case 'all_fronts': targets = context.gameState.fronts.map((front) => ({ kind: 'front' as const, front })); break;
  }
  const excludesSelfByDefault = ['same_front_allies', 'adjacent_front_allies', 'all_allies', 'matching_tag', 'matching_era', 'matching_region'].includes(selector.type);
  if (source && (selector.includeSelf === false || selector.includeSelf === undefined && excludesSelfByDefault)) {
    targets = targets.filter((target) => target.kind !== 'card' || target.card.instanceId !== source.card.instanceId);
  }
  for (const filter of selector.filters ?? []) targets = targets.filter((target) => compare(filterValue(context, target, filter), filter.operator, filter.value));
  targets = [...new Map(targets.map((target) => [targetKey(target), target])).values()];
  if (selector.random && targets.length > 1) {
    const rng = SeededRandom.fromState(context.gameState.rngState);
    targets = rng.shuffle(targets);
    context.gameState.rngState = rng.getState();
  }
  return targets.slice(0, Math.max(0, selector.count ?? defaultCount(selector.type, targets.length)));
}
