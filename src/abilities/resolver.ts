import {
  MAX_EVENTS_PER_RESOLUTION,
  MAX_TRIGGER_DEPTH,
  RuleError,
  type AbilityContext,
  type AbilityUsageState,
  type CardInstance,
  type GameEvent
} from '../types.js';
import { evaluateConditions } from './conditions.js';
import { applyEffect } from './effects.js';
import { selectTargets } from './selectors.js';
import { emit, ensureInstanceState, findInstance, ownerOf } from './runtime.js';

function usageOf(card: CardInstance, abilityId: string): AbilityUsageState {
  ensureInstanceState(card);
  card.abilityUsage![abilityId] ??= { total: 0, turns: {}, fronts: {} };
  return card.abilityUsage![abilityId]!;
}

function withinLimit(context: AbilityContext, card?: CardInstance): boolean {
  const limit = context.ability.limit;
  if (!limit || !card) return true;
  const usage = usageOf(card, context.ability.abilityId);
  const turnKey = String(context.turn);
  const frontKey = context.sourceFrontId ?? card.frontId;
  if (limit.scope === 'once_per_turn') return (usage.turns[turnKey] ?? 0) < 1;
  if (limit.scope === 'once_per_game' || limit.scope === 'first_only') return usage.total < 1;
  if (limit.scope === 'once_per_front') return (usage.fronts[frontKey] ?? 0) < 1;
  return usage.total < Math.max(1, limit.count ?? 1);
}

function recordUsage(context: AbilityContext, card?: CardInstance): void {
  if (!card) return;
  const usage = usageOf(card, context.ability.abilityId);
  const turnKey = String(context.turn);
  const frontKey = context.sourceFrontId ?? card.frontId;
  usage.total += 1;
  usage.turns[turnKey] = (usage.turns[turnKey] ?? 0) + 1;
  usage.fronts[frontKey] = (usage.fronts[frontKey] ?? 0) + 1;
}

export function resolveAbility(context: AbilityContext): GameEvent[] {
  if (context.depth > MAX_TRIGGER_DEPTH) throw new RuleError('TRIGGER_DEPTH_EXCEEDED', 'Ability trigger depth exceeded.', { depth: context.depth });
  const source = findInstance(context)?.card;
  if (source?.silenced || source?.statuses?.includes('ongoing_removed') && context.ability.trigger === 'ongoing') return context.eventQueue;
  const front = context.gameState.fronts.find((candidate) => candidate.definition.frontId === context.sourceFrontId);
  if (front?.abilityBlockedFor?.includes(context.sourcePlayerId)) return context.eventQueue;
  if (!withinLimit(context, source) || !evaluateConditions(context)) return context.eventQueue;
  context.gameState.abilityStack ??= [];
  const matchingFrames = context.gameState.abilityStack.filter((frame) => frame.sourceInstanceId === context.sourceInstanceId && frame.abilityId === context.ability.abilityId).length;
  if (matchingFrames >= MAX_TRIGGER_DEPTH) throw new RuleError('REPEATED_TRIGGER', 'Repeated ability trigger protection activated.', { abilityId: context.ability.abilityId });
  context.gameState.abilityStack.push({ sourceInstanceId: context.sourceInstanceId, abilityId: context.ability.abilityId, trigger: context.ability.trigger, depth: context.depth });
  emit(context, 'ability_started', { trigger: context.ability.trigger, depth: context.depth });
  const targets = selectTargets(context);
  const repeat = (times: number): void => {
    const nested = { ...context.ability, effects: context.ability.effects.filter((effect) => effect.type !== 'repeat_ability') };
    for (let index = 0; index < times; index += 1) resolveAbility({ ...context, ability: nested, depth: context.depth + 1 });
  };
  let changed = 0;
  for (const effect of context.ability.effects) {
    const beforePower = new Map(targets.filter((target) => target.kind === 'card').map((target) => [target.card.instanceId, target.card.currentPower]));
    const effectChanged = applyEffect({ context, effect, targets, repeat });
    changed += effectChanged;
    const deltas = targets.flatMap((target) => {
      if (target.kind !== 'card') return [];
      const before = beforePower.get(target.card.instanceId) ?? target.card.currentPower;
      const amount = target.card.currentPower - before;
      return amount === 0 ? [] : [{ playerId: target.owner.playerId, instanceId: target.card.instanceId, cardId: target.card.cardId, amount }];
    });
    emit(context, 'ability_effect_applied', {
      effectType: effect.type,
      changed: effectChanged,
      targetInstanceIds: targets.filter((target) => target.kind === 'card').map((target) => target.card.instanceId),
      deltas
    });
    if (context.eventQueue.length > MAX_EVENTS_PER_RESOLUTION) throw new RuleError('EVENT_LIMIT_EXCEEDED', 'Ability event limit exceeded.');
  }
  recordUsage(context, source);
  emit(context, 'ability_resolved', { trigger: context.ability.trigger, targets: targets.length, changed, depth: context.depth });
  context.gameState.abilityStack.pop();
  return context.eventQueue;
}

function scaleAmount(context: AbilityContext, source: CardInstance, scaleBy: NonNullable<(typeof context.ability.effects)[number]['scaleBy']>): number {
  const owner = ownerOf(context);
  const lane = owner.fronts[source.frontId] ?? [];
  if (scaleBy === 'other_allies') return Math.max(0, lane.length - 1);
  if (scaleBy === 'matching_tags') {
    const tags = context.gameState.cardCatalog[source.cardId]?.tags ?? [];
    return lane.filter((card) => card.instanceId !== source.instanceId && context.gameState.cardCatalog[card.cardId]?.tags.some((tag) => tags.includes(tag))).length;
  }
  if (scaleBy === 'distinct_eras') return new Set(lane.map((card) => context.gameState.cardCatalog[card.cardId]?.era).filter(Boolean)).size;
  if (scaleBy === 'distinct_regions') return new Set(lane.map((card) => context.gameState.cardCatalog[card.cardId]?.region).filter(Boolean)).size;
  if (scaleBy === 'marker_count') return Object.values(source.markers ?? {}).reduce((sum, count) => sum + count, 0);
  return 1;
}

export function ongoingPowerAdjustments(context: AbilityContext): Map<string, number> {
  const adjustments = new Map<string, number>();
  const source = findInstance(context)?.card;
  if (!source || source.silenced || source.statuses?.includes('ongoing_removed') || !evaluateConditions(context)) return adjustments;
  const targets = selectTargets(context);
  for (const effect of context.ability.effects) {
    if (!['add_power', 'reduce_power', 'set_power'].includes(effect.type)) continue;
    const factor = effect.scaleBy ? scaleAmount(context, source, effect.scaleBy) : 1;
    for (const target of targets) {
      if (target.kind !== 'card') continue;
      const raw = Number(effect.value ?? effect.amount ?? 0) * factor;
      const delta = effect.type === 'reduce_power' ? -Math.abs(raw) : effect.type === 'set_power' ? raw - target.card.currentPower : raw;
      adjustments.set(target.card.instanceId, (adjustments.get(target.card.instanceId) ?? 0) + delta);
    }
  }
  return adjustments;
}
