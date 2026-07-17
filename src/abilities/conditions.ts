import type { AbilityCondition, AbilityConditionType, AbilityContext, CardInstance, PlayerState } from '../types.js';
import { compare, ensurePlayerState, findInstance, opponentOf, ownerOf, sourceDefinition } from './runtime.js';

export const CONDITION_TYPES: AbilityConditionType[] = [
  'turn', 'front_card_count', 'front_total_power', 'is_leading', 'is_trailing', 'card_cost', 'base_power',
  'current_power', 'era', 'region', 'profession', 'identity', 'faction', 'tag', 'was_moved', 'created_by_effect',
  'died_before', 'first_trigger', 'hand_count', 'deck_count', 'graveyard_count', 'controlled_fronts', 'has_initiative',
  'stake', 'banner_raised', 'deployments_this_game', 'moves_this_game', 'deaths_this_game', 'discards_this_game',
  'cards_drawn_this_game', 'deck_tag_count', 'marker_count', 'source_is_token'
];

const lanePower = (player: PlayerState, frontId: string): number =>
  (player.fronts[frontId] ?? []).reduce((sum, card) => sum + card.currentPower, 0);

function controlledFronts(context: AbilityContext, player: PlayerState): number {
  const opponent = context.gameState.players.find((candidate) => candidate.playerId !== player.playerId)!;
  return context.gameState.fronts.filter((front) => lanePower(player, front.definition.frontId) > lanePower(opponent, front.definition.frontId)).length;
}

function counterValue(player: PlayerState, key: keyof NonNullable<PlayerState['counters']>): number {
  ensurePlayerState(player);
  return player.counters?.[key] ?? 0;
}

function conditionValue(context: AbilityContext, condition: AbilityCondition, source?: CardInstance): unknown {
  const owner = ownerOf(context);
  const opponent = opponentOf(context);
  const definition = sourceDefinition(context);
  const frontId = context.sourceFrontId ?? source?.frontId ?? '';
  const scopedPlayer = condition.scope === 'opponent' ? opponent : owner;
  switch (condition.type) {
    case 'turn': return context.turn;
    case 'front_card_count': return (scopedPlayer.fronts[frontId] ?? []).length;
    case 'front_total_power': return lanePower(scopedPlayer, frontId);
    case 'is_leading': return lanePower(owner, frontId) > lanePower(opponent, frontId);
    case 'is_trailing': return lanePower(owner, frontId) < lanePower(opponent, frontId);
    case 'card_cost': return source?.currentCost || definition?.cost || 0;
    case 'base_power': return definition?.power ?? 0;
    case 'current_power': return source?.currentPower ?? definition?.power ?? 0;
    case 'era': return definition?.era;
    case 'region': return definition?.region;
    case 'profession': return definition?.profession;
    case 'identity': return definition?.identity;
    case 'faction': return definition?.faction;
    case 'tag': return definition?.tags ?? [];
    case 'was_moved': return source?.moved === true;
    case 'created_by_effect': return source?.createdByEffect === true;
    case 'died_before': return owner.graveyard.some((card) => card.cardId === context.sourceCardId);
    case 'first_trigger': return (source?.abilityUsage?.[context.ability.abilityId]?.total ?? 0) === 0;
    case 'hand_count': return scopedPlayer.hand.length;
    case 'deck_count': return scopedPlayer.deck.length;
    case 'graveyard_count': return scopedPlayer.graveyard.length;
    case 'controlled_fronts': return controlledFronts(context, scopedPlayer);
    case 'has_initiative': return context.gameState.initiativePlayerId === scopedPlayer.playerId;
    case 'stake': return context.gameState.stake.current;
    case 'banner_raised': return scopedPlayer.bannerUsed;
    case 'deployments_this_game': return counterValue(scopedPlayer, 'deployments');
    case 'moves_this_game': return counterValue(scopedPlayer, 'moves');
    case 'deaths_this_game': return counterValue(scopedPlayer, 'deaths');
    case 'discards_this_game': return counterValue(scopedPlayer, 'discards');
    case 'cards_drawn_this_game': return counterValue(scopedPlayer, 'cardsDrawn');
    case 'deck_tag_count': return scopedPlayer.deck.filter((cardId) => context.gameState.cardCatalog[cardId]?.tags.includes(condition.tag ?? String(condition.value ?? ''))).length;
    case 'marker_count': return source?.markers?.[condition.tag ?? '传世'] ?? 0;
    case 'source_is_token': return definition?.token === true;
  }
}

export function evaluateCondition(context: AbilityContext, condition: AbilityCondition): boolean {
  const source = findInstance(context)?.card;
  const actual = conditionValue(context, condition, source);
  const expected = condition.values ?? condition.value ?? true;
  if (condition.values) return condition.values.some((value) => compare(actual, condition.operator, value));
  return compare(actual, condition.operator, expected);
}

export function evaluateConditions(context: AbilityContext): boolean {
  return (context.ability.conditions ?? []).every((condition) => evaluateCondition(context, condition));
}
