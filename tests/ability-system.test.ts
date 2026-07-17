import { describe, expect, it } from 'vitest';
import {
  ATOMIC_EFFECT_TYPES,
  CONDITION_TYPES,
  DECK_SIZE,
  EFFECT_HANDLERS,
  FRONT_DEFINITIONS,
  TARGET_SELECTOR_TYPES,
  TRIGGER_ORDER,
  applyEffect,
  areFrontsCompatible,
  createGame,
  evaluateCondition,
  selectTargets,
  validateAbilitySpec,
  type AbilityCondition,
  type AbilityContext,
  type CardAbilitySpec,
  type CardDefinition,
  type CardInstance,
  type EffectSpec,
  type GameState,
  type TargetSelector
} from '../src/index.js';

const makeCard = (index: number): CardDefinition => ({
  cardId: `af-system-${index}`,
  characterUid: `system-${index}`,
  characterId: `SYSTEM${index}`,
  slug: `system-${index}`,
  nameZh: `系统角色${index}`,
  cost: index % 6 + 1,
  power: index % 8 + 3,
  abilityId: 'deploy_boost_self',
  abilityArgs: { amount: 1 },
  abilityTextZh: '部署：自身战力+1。',
  trigger: 'deploy',
  targetRule: 'self',
  faction: index % 2 ? '甲阵营' : '乙阵营',
  era: index % 2 ? '现代' : '神话时代',
  region: index % 2 ? '东亚' : '中东',
  profession: index % 2 ? '统帅' : '学者',
  identity: index % 2 ? '将军' : '国王',
  rarity: 'A级',
  description: '能力系统测试卡牌。',
  sourceAbility: '系统验证',
  tags: [index % 2 ? '军事' : '建设'],
  set: 'core',
  packId: 'core',
  version: 2,
  imageKey: `系统角色${index}`
});

const cards = Array.from({ length: DECK_SIZE * 2 }, (_, index) => makeCard(index));

function game(): GameState {
  return createGame({
    seed: 20260717,
    cards,
    fronts: FRONT_DEFINITIONS,
    players: [
      { playerId: 'p1', name: '甲', deck: cards.slice(0, DECK_SIZE).map((card) => card.cardId) },
      { playerId: 'p2', name: '乙', deck: cards.slice(DECK_SIZE).map((card) => card.cardId) }
    ]
  });
}

function instance(state: GameState, playerId: string, cardId: string, frontId: string, suffix: string): CardInstance {
  const definition = state.cardCatalog[cardId]!;
  const card: CardInstance = {
    instanceId: `manual-${suffix}`,
    cardId,
    ownerId: playerId,
    currentPower: definition.power,
    currentCost: definition.cost,
    frontId,
    revealed: true,
    silenced: false,
    deployedTurn: state.turn,
    modifiers: [],
    markers: {},
    statuses: [],
    abilityUsage: {},
    moved: false,
    createdByEffect: false
  };
  state.players.find((player) => player.playerId === playerId)!.fronts[frontId]!.push(card);
  return card;
}

const ability = (overrides: Partial<CardAbilitySpec> = {}): CardAbilitySpec => ({
  abilityId: 'system-test',
  nameZh: '系统测试',
  textZh: '部署：执行系统测试效果。',
  trigger: 'on_deploy',
  target: { type: 'self' },
  effects: [{ type: 'add_power', amount: 1 }],
  ...overrides
});

function contextFor(state: GameState, spec: CardAbilitySpec): AbilityContext {
  const frontId = state.fronts[1]!.definition.frontId;
  const source = instance(state, 'p1', cards[0]!.cardId, frontId, 'source');
  instance(state, 'p1', cards[1]!.cardId, state.fronts[0]!.definition.frontId, 'ally');
  instance(state, 'p2', cards[12]!.cardId, frontId, 'enemy');
  return {
    gameState: state,
    ability: spec,
    sourceCardId: source.cardId,
    sourceInstanceId: source.instanceId,
    sourcePlayerId: source.ownerId,
    sourceFrontId: source.frontId,
    turn: state.turn,
    eventQueue: [],
    depth: 0
  };
}

describe('expanded ability vocabulary', () => {
  it('registers every required lifecycle trigger', () => {
    expect(TRIGGER_ORDER).toHaveLength(25);
    expect(new Set(TRIGGER_ORDER).size).toBe(TRIGGER_ORDER.length);
  });

  it.each(CONDITION_TYPES)('validates and evaluates condition %s', (conditionType) => {
    const condition: AbilityCondition = { type: conditionType, operator: 'not_equals', value: '__never__', tag: '军事' };
    const spec = ability({ conditions: [condition] });
    expect(validateAbilitySpec(spec)).toEqual([]);
    expect(typeof evaluateCondition(contextFor(game(), spec), condition)).toBe('boolean');
  });

  it.each(TARGET_SELECTOR_TYPES)('resolves selector %s deterministically', (selectorType) => {
    const selector: TargetSelector = {
      type: selectorType,
      side: 'both',
      includeSelf: true,
      count: 3,
      tag: '军事',
      era: '现代',
      region: '东亚'
    };
    const spec = ability({ target: selector });
    const first = contextFor(game(), spec);
    const second = contextFor(game(), spec);
    expect(selectTargets(first, selector).map((target) => target.kind)).toEqual(selectTargets(second, selector).map((target) => target.kind));
  });

  it('exposes at least thirty-two executable atomic effects', () => {
    expect(ATOMIC_EFFECT_TYPES).toHaveLength(44);
    expect(EFFECT_HANDLERS.size).toBe(ATOMIC_EFFECT_TYPES.length);
  });
});

const targetForEffect = (type: EffectSpec['type']): TargetSelector => {
  if (['draw_cards', 'gain_energy', 'lose_energy', 'store_energy', 'seize_initiative', 'discard_cards'].includes(type)) return type === 'discard_cards' ? { type: 'opponent' } : { type: 'owner' };
  if (['block_deploy', 'block_move', 'increase_capacity', 'decrease_capacity'].includes(type)) return { type: 'source_front' };
  if (['swap_power', 'copy_power', 'swap_positions'].includes(type)) return { type: 'all_allies', includeSelf: true, count: 2 };
  if (['revive_card', 'return_to_hand'].includes(type)) return { type: 'owner_graveyard', count: 1 };
  return { type: 'self' };
};

const configuredEffect = (type: EffectSpec['type']): EffectSpec => ({
  type,
  amount: 1,
  value: type === 'set_status' ? 'tested' : type === 'set_power' || type === 'set_cost' ? 5 : 1,
  cardId: cards[2]!.cardId,
  tokenId: cards[3]!.cardId,
  marker: 'test',
  status: 'tested',
  destination: 'left',
  counter: 'deployments',
  tag: '军事',
  multiplier: 1,
  target: targetForEffect(type)
});

describe.each(ATOMIC_EFFECT_TYPES)('atomic effect %s', (effectType) => {
  it('executes in a minimum legal game state without crashing', () => {
    const state = game();
    const spec = ability({ effects: [configuredEffect(effectType)] });
    const context = contextFor(state, spec);
    const owner = state.players[0];
    const grave = instance(state, 'p1', cards[4]!.cardId, context.sourceFrontId!, 'grave');
    owner.fronts[context.sourceFrontId!] = owner.fronts[context.sourceFrontId!]!.filter((card) => card.instanceId !== grave.instanceId);
    owner.graveyard.push(grave);
    owner.discarded = [cards[5]!.cardId];
    const targets = selectTargets(context, spec.target);
    let repeats = 0;
    expect(() => applyEffect({ context, effect: spec.effects[0]!, targets, repeat: (times) => { repeats += times; } })).not.toThrow();
    if (effectType === 'repeat_ability') expect(repeats).toBe(1);
    expect(context.eventQueue.some((event) => event.type === 'ability_effect_resolved')).toBe(true);
  });
});

describe('front pool quality', () => {
  it('meets category coverage and compatibility requirements', () => {
    const count = (category: string) => FRONT_DEFINITIONS.filter((front) => front.categories.includes(category)).length;
    expect(FRONT_DEFINITIONS).toHaveLength(72);
    expect(count('movement') + count('capacity')).toBeGreaterThanOrEqual(12);
    expect(count('economy')).toBeGreaterThanOrEqual(12);
    expect(count('trait')).toBeGreaterThanOrEqual(12);
    expect(count('dynamic')).toBeGreaterThanOrEqual(12);
    expect(count('high-risk')).toBeGreaterThanOrEqual(8);
    expect(count('hidden')).toBeGreaterThanOrEqual(8);
    expect(count('death')).toBeGreaterThanOrEqual(8);
  });

  it('selects only mutually compatible fronts across seeded games', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const state = createGame({
        seed,
        cards,
        fronts: FRONT_DEFINITIONS,
        players: [
          { playerId: 'p1', name: '甲', deck: cards.slice(0, DECK_SIZE).map((card) => card.cardId) },
          { playerId: 'p2', name: '乙', deck: cards.slice(DECK_SIZE).map((card) => card.cardId) }
        ]
      });
      for (const front of state.fronts) expect(areFrontsCompatible(state.fronts.filter((candidate) => candidate !== front).map((candidate) => candidate.definition), front.definition)).toBe(true);
    }
  });
});
