import { describe, expect, it } from 'vitest';
import {
  ABILITY_DEFINITIONS,
  ABILITY_REGISTRY,
  DECK_SIZE,
  FRONT_DEFINITIONS,
  PROTOCOL_VERSION,
  SeededRandom,
  applyFrontTurnEffect,
  calculateFrontPower,
  createGame,
  createPlayerView,
  createPublicView,
  deserializeGame,
  getEffectiveCost,
  getFrontCapacity,
  lockTurn,
  raiseBanner,
  replayGameEvents,
  serializeGame,
  submitTurnIntent,
  undoTurnIntent,
  validateCardDefinitions,
  validateDeck,
  validateFrontDefinitions,
  validateTurnIntent,
  verifyReplay,
  withdraw,
  type CardDefinition,
  type CardInstance,
  type GameOptions,
  type GameState,
  type TurnIntent
} from '../src/index.js';

const makeCard = (index: number, overrides: Partial<CardDefinition> = {}): CardDefinition => ({
  cardId: `af-card-${index}`,
  characterUid: String(index).padStart(4, '0'),
  characterId: `CHAR${index}`,
  slug: `card-${index}`,
  nameZh: `角色${index}`,
  cost: (index % 6) + 1,
  power: (index % 9) + 1,
  abilityId: 'deploy_boost_self',
  abilityArgs: { amount: 2 },
  abilityTextZh: '部署：自身战力+2。',
  trigger: 'deploy',
  targetRule: 'self',
  faction: '测试阵营',
  era: index % 2 === 0 ? '神话时代' : '青铜时代',
  region: index % 2 === 0 ? '东亚' : '中东',
  profession: index % 2 === 0 ? '建设者' : '征服者',
  identity: index % 2 === 0 ? '皇帝' : '国王',
  rarity: 'A级',
  description: '用于规则测试的确定性卡牌。',
  sourceAbility: '测试技能',
  tags: [index % 2 === 0 ? '建设' : '军事'],
  set: 'core',
  version: 1,
  imageKey: `角色${index}`,
  ...overrides
});

const cards = Array.from({ length: 24 }, (_, index) => makeCard(index));

const makeOptions = (seed = 42): GameOptions => ({
  seed,
  cards,
  fronts: FRONT_DEFINITIONS,
  players: [
    { playerId: 'p1', name: '甲', deck: cards.slice(0, DECK_SIZE).map((card) => card.cardId) },
    { playerId: 'p2', name: '乙', deck: cards.slice(DECK_SIZE, DECK_SIZE * 2).map((card) => card.cardId) }
  ]
});

const makeGame = (seed = 42): GameState => createGame(makeOptions(seed));

const emptyTurn = (state: GameState): void => {
  const turn = state.turn;
  expect(lockTurn(state, 'p1', `lock-${turn}-p1`).ok).toBe(true);
  expect(lockTurn(state, 'p2', `lock-${turn}-p2`).ok).toBe(true);
};

const addInstance = (state: GameState, playerId: string, frontId: string, cardId: string, power = 3): CardInstance => {
  const instance: CardInstance = {
    instanceId: `manual-${playerId}-${frontId}-${cardId}`,
    cardId,
    ownerId: playerId,
    currentPower: power,
    frontId,
    revealed: true,
    silenced: false,
    deployedTurn: state.turn,
    modifiers: []
  };
  state.players.find((player) => player.playerId === playerId)!.fronts[frontId]!.push(instance);
  return instance;
};

describe('seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const first = new SeededRandom(123);
    const second = new SeededRandom(123);
    expect(Array.from({ length: 20 }, () => first.nextUint32())).toEqual(Array.from({ length: 20 }, () => second.nextUint32()));
  });

  it('produces different sequences for different seeds', () => {
    const first = new SeededRandom(123);
    const second = new SeededRandom(124);
    expect(first.nextUint32()).not.toBe(second.nextUint32());
  });

  it('shuffles without changing membership', () => {
    const values = [1, 2, 3, 4, 5, 6];
    expect(new SeededRandom(8).shuffle(values).sort()).toEqual(values);
  });

  it('rejects invalid integer bounds', () => {
    expect(() => new SeededRandom(1).int(0)).toThrow(RangeError);
  });
});

describe('data validation', () => {
  it('accepts the complete card catalog', () => {
    expect(validateCardDefinitions(cards)).toEqual({ ok: true });
  });

  it('rejects duplicate card ids', () => {
    const result = validateCardDefinitions([cards[0]!, { ...cards[1]!, cardId: cards[0]!.cardId }]);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate slugs', () => {
    const result = validateCardDefinitions([cards[0]!, { ...cards[1]!, slug: cards[0]!.slug }]);
    expect(result.ok).toBe(false);
  });

  it('rejects unregistered abilities', () => {
    expect(validateCardDefinitions([{ ...cards[0]!, abilityId: 'missing' }]).ok).toBe(false);
  });

  it('accepts a unique twelve-card deck', () => {
    expect(validateDeck(cards.slice(0, 12).map((card) => card.cardId), Object.fromEntries(cards.map((card) => [card.cardId, card])))).toEqual({ ok: true });
  });

  it('rejects an eleven-card deck', () => {
    expect(validateDeck(cards.slice(0, 11).map((card) => card.cardId), Object.fromEntries(cards.map((card) => [card.cardId, card]))).ok).toBe(false);
  });

  it('rejects duplicate cards in a deck', () => {
    const deck = cards.slice(0, 11).map((card) => card.cardId).concat(cards[0]!.cardId);
    expect(validateDeck(deck, Object.fromEntries(cards.map((card) => [card.cardId, card]))).ok).toBe(false);
  });

  it('accepts all seventy-two front definitions together', () => {
    expect(validateFrontDefinitions(FRONT_DEFINITIONS)).toEqual([]);
    expect(FRONT_DEFINITIONS).toHaveLength(72);
  });
});

describe.each(FRONT_DEFINITIONS)('front $frontId', (front) => {
  it('has complete, enabled and unique executable metadata', () => {
    expect(front.enabled).toBe(true);
    expect(front.weight).toBeGreaterThan(0);
    expect(front.nameZh.length).toBeGreaterThan(1);
    expect(front.nameEn.length).toBeGreaterThan(1);
    expect(front.descriptionZh).toContain('。');
    expect(FRONT_DEFINITIONS.filter((candidate) => candidate.frontId === front.frontId)).toHaveLength(1);
    expect(FRONT_DEFINITIONS.filter((candidate) => candidate.effectId === front.effectId)).toHaveLength(1);
  });
});

describe.each(ABILITY_DEFINITIONS)('ability $abilityId', (ability) => {
  it('is registered with a trigger and target rule', () => {
    expect(ABILITY_REGISTRY.has(ability.abilityId)).toBe(true);
    expect(['deploy', 'on_play', 'ongoing', 'turn_start', 'turn_end', 'finale']).toContain(ability.trigger);
    expect(ability.targetRule.length).toBeGreaterThan(0);
  });
});

describe('game lifecycle', () => {
  it('accepts JSON-compatible proxy-like catalog input', () => {
    const proxiedCards = makeOptions().cards.map((card) => new Proxy(card, {}));
    expect(createGame({ ...makeOptions(), cards: proxiedCards }).cardCatalog['af-card-0']?.nameZh).toBe('角色0');
  });

  it('creates a versioned game with three unique fronts', () => {
    const state = makeGame();
    expect(state.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(state.fronts).toHaveLength(3);
    expect(new Set(state.fronts.map((front) => front.definition.frontId)).size).toBe(3);
  });

  it('deals three opening cards and one first-turn draw', () => {
    const state = makeGame();
    expect(state.players.map((player) => player.hand.length)).toEqual([4, 4]);
    expect(state.players.map((player) => player.deck.length)).toEqual([8, 8]);
  });

  it('reveals the first front on turn one', () => {
    expect(makeGame().fronts.map((front) => front.revealed)).toEqual([true, false, false]);
  });

  it('increments military orders with the turn', () => {
    const state = makeGame();
    expect(state.players[0].energy).toBe(1);
    emptyTurn(state);
    expect(state.turn).toBe(2);
    expect(state.players[0].energy).toBe(2);
  });

  it('reveals all fronts by turn three', () => {
    const state = makeGame();
    emptyTurn(state);
    emptyTurn(state);
    expect(state.turn).toBe(3);
    expect(state.fronts.every((front) => front.revealed)).toBe(true);
  });

  it('finishes after six resolved turns', () => {
    const state = makeGame();
    while (state.phase !== 'ended') emptyTurn(state);
    expect(state.turn).toBe(6);
    expect(state.winner).not.toBeNull();
  });

  it('is deterministic for identical setup and actions', () => {
    const first = makeGame(99);
    const second = makeGame(99);
    for (let turn = 1; turn <= 6; turn += 1) {
      emptyTurn(first);
      emptyTurn(second);
    }
    expect(serializeGame(first)).toBe(serializeGame(second));
  });

  it('serializes and deserializes without changing state', () => {
    const state = makeGame();
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('turn validation and resolution', () => {
  it('rejects a stale turn number', () => {
    const state = makeGame();
    expect(validateTurnIntent(state, 'p1', { requestId: 'old', turn: 0, deployments: [] }).ok).toBe(false);
  });

  it('rejects cards outside the hand', () => {
    const state = makeGame();
    const intent: TurnIntent = { requestId: 'bad-hand', turn: 1, deployments: [{ cardId: 'af-card-23', frontId: state.fronts[0]!.definition.frontId, order: 0 }] };
    expect(validateTurnIntent(state, 'p1', intent).ok).toBe(false);
  });

  it('rejects plans above the energy budget', () => {
    const state = makeGame();
    const owner = state.players[0];
    const expensive = owner.hand.find((cardId) => state.cardCatalog[cardId]!.cost > 1) ?? owner.hand[0]!;
    state.cardCatalog[expensive]!.cost = 6;
    const intent: TurnIntent = { requestId: 'too-costly', turn: 1, deployments: [{ cardId: expensive, frontId: state.fronts[0]!.definition.frontId, order: 0 }] };
    expect(validateTurnIntent(state, owner.playerId, intent).ok).toBe(false);
  });

  it('rejects duplicate deployment of the same hand card', () => {
    const state = makeGame();
    const owner = state.players[0];
    const cardId = owner.hand[0]!;
    const frontId = state.fronts[0]!.definition.frontId;
    expect(validateTurnIntent(state, owner.playerId, { requestId: 'duplicate', turn: 1, deployments: [{ cardId, frontId, order: 0 }, { cardId, frontId, order: 1 }] }).ok).toBe(false);
  });

  it('enforces front capacity', () => {
    const state = makeGame();
    const owner = state.players[0];
    const frontId = state.fronts[0]!.definition.frontId;
    for (let index = 0; index < getFrontCapacity(state, owner.playerId, frontId); index += 1) addInstance(state, owner.playerId, frontId, owner.deck[index]!);
    const cardId = owner.hand[0]!;
    state.cardCatalog[cardId]!.cost = 1;
    expect(validateTurnIntent(state, owner.playerId, { requestId: 'full', turn: 1, deployments: [{ cardId, frontId, order: 0 }] }).ok).toBe(false);
  });

  it('accepts an idempotent repeated request', () => {
    const state = makeGame();
    const intent: TurnIntent = { requestId: 'same', turn: 1, deployments: [] };
    expect(submitTurnIntent(state, 'p1', intent)).toEqual({ ok: true });
    expect(submitTurnIntent(state, 'p1', intent)).toEqual({ ok: true });
    expect(state.eventLog.filter((event) => event.type === 'turn_submitted' && event.playerId === 'p1')).toHaveLength(1);
  });

  it('allows undo before lock and rejects it after lock', () => {
    const state = makeGame();
    submitTurnIntent(state, 'p1', { requestId: 'plan', turn: 1, deployments: [] });
    expect(undoTurnIntent(state, 'p1', 'undo').ok).toBe(true);
    expect(lockTurn(state, 'p1', 'lock').ok).toBe(true);
    expect(undoTurnIntent(state, 'p1', 'late-undo').ok).toBe(false);
  });

  it('resolves only after both players lock', () => {
    const state = makeGame();
    lockTurn(state, 'p1', 'first-lock');
    expect(state.turn).toBe(1);
    lockTurn(state, 'p2', 'second-lock');
    expect(state.turn).toBe(2);
  });

  it('records deterministic reveal order', () => {
    const state = makeGame();
    emptyTurn(state);
    const event = state.eventLog.find((candidate) => candidate.type === 'reveal_order');
    expect(event?.payload.playerIds).toEqual([state.setup.players.find((player) => player.playerId === (event?.payload.playerIds as string[])[0])!.playerId, (event?.payload.playerIds as string[])[1]]);
  });

  it('logs a deterministic fizzle when disruption removes a locked card', () => {
    const state = makeGame(991);
    const frontId = state.fronts[0]!.definition.frontId;
    const disruptor = cards[0]!;
    const target = cards[12]!;
    Object.assign(state.cardCatalog[disruptor.cardId]!, {
      abilityId: 'discard_pressure',
      abilityArgs: { amount: 1 },
      abilityTextZh: '部署：对手弃置一张手牌。',
      trigger: 'deploy',
      targetRule: 'opponent_hand'
    });
    delete state.cardCatalog[disruptor.cardId]!.abilities;
    state.players[0].hand = [disruptor.cardId];
    state.players[1].hand = [target.cardId];
    state.players[0].energy = 6;
    state.players[1].energy = 6;
    state.initiativePlayerId = 'p1';
    expect(submitTurnIntent(state, 'p1', { requestId: 'fizzle-p1', turn: state.turn, deployments: [{ cardId: disruptor.cardId, frontId, order: 0 }] }).ok).toBe(true);
    expect(submitTurnIntent(state, 'p2', { requestId: 'fizzle-p2', turn: state.turn, deployments: [{ cardId: target.cardId, frontId, order: 0 }] }).ok).toBe(true);
    expect(lockTurn(state, 'p1', 'fizzle-lock-p1').ok).toBe(true);
    expect(lockTurn(state, 'p2', 'fizzle-lock-p2').ok).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'deployment_fizzled' && event.payload.reason === 'card_left_hand')).toBe(true);
  });
});

describe('front mechanics', () => {
  it('lowers and raises deployment costs', () => {
    const state = makeGame();
    const card = cards[5]!;
    state.fronts[0]!.definition = FRONT_DEFINITIONS.find((front) => front.effectId === 'cost_down')!;
    expect(getEffectiveCost(state, card, state.fronts[0]!.definition.frontId)).toBe(card.cost - 1);
    state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId: 'cost_up' };
    expect(getEffectiveCost(state, card, state.fronts[0]!.definition.frontId)).toBe(card.cost + 1);
  });

  it('changes front capacity', () => {
    const state = makeGame();
    const originalId = state.fronts[0]!.definition.frontId;
    state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId: 'capacity_up', effectArgs: { amount: 1 } };
    expect(getFrontCapacity(state, 'p1', originalId)).toBe(5);
    state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId: 'capacity_down', effectArgs: { amount: 1 } };
    expect(getFrontCapacity(state, 'p1', originalId)).toBe(3);
  });

  it('applies fixed power modifiers', () => {
    const state = makeGame();
    const frontId = state.fronts[0]!.definition.frontId;
    addInstance(state, 'p1', frontId, cards[0]!.cardId, 5);
    state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId: 'base_power_up', effectArgs: { amount: 2 } };
    expect(calculateFrontPower(state, 'p1', frontId)).toBe(7);
  });

  it('applies era, region, profession and identity bonuses', () => {
    const state = makeGame();
    const frontId = state.fronts[0]!.definition.frontId;
    addInstance(state, 'p1', frontId, cards[0]!.cardId, 5);
    for (const [effectId, effectArgs] of [
      ['era_bonus', { era: '神话时代', amount: 3 }],
      ['region_bonus', { region: '东亚', amount: 3 }],
      ['profession_bonus', { professionIncludes: '建', amount: 3 }],
      ['identity_bonus', { identities: ['皇帝'], amount: 3 }]
    ] as const) {
      state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId, effectArgs };
      expect(calculateFrontPower(state, 'p1', frontId)).toBe(8);
    }
  });

  it('reports every registered front effect as executable', () => {
    for (const definition of FRONT_DEFINITIONS) {
      const state = makeGame();
      const existingId = state.fronts[0]!.definition.frontId;
      state.fronts[0]!.definition = { ...definition, frontId: existingId };
      expect(applyFrontTurnEffect(state, existingId).applied, definition.effectId).toBe(true);
    }
  });

  it('hides cipher-field power from the opponent', () => {
    const state = makeGame();
    const frontId = state.fronts[0]!.definition.frontId;
    state.fronts[0]!.definition = { ...state.fronts[0]!.definition, effectId: 'hidden_power' };
    addInstance(state, 'p1', frontId, cards[0]!.cardId, 5);
    const p2View = createPlayerView(state, 'p2');
    expect(p2View.fronts[0]!.power.p1).toBeNull();
    expect(createPlayerView(state, 'p1').fronts[0]!.power.p1).toBe(5);
  });
});

describe('stake, privacy and replay', () => {
  it('delays banner stake until the next turn', () => {
    const state = makeGame();
    expect(raiseBanner(state, 'p1', 'banner').ok).toBe(true);
    expect(state.stake.current).toBe(1);
    expect(state.stake.pending).toBe(2);
    emptyTurn(state);
    expect(state.stake.current).toBe(2);
  });

  it('allows each player to raise only once', () => {
    const state = makeGame();
    expect(raiseBanner(state, 'p1', 'first').ok).toBe(true);
    emptyTurn(state);
    expect(raiseBanner(state, 'p1', 'second').ok).toBe(false);
  });

  it('uses the active rather than pending stake on withdrawal', () => {
    const state = makeGame();
    raiseBanner(state, 'p1', 'banner-before-withdraw');
    withdraw(state, 'p2', 'withdraw');
    expect(state.winner?.stake).toBe(1);
    expect(state.winner?.winnerId).toBe('p1');
  });

  it('automatically doubles the stake on turn six', () => {
    const state = makeGame();
    while (state.turn < 6) emptyTurn(state);
    expect(state.stake.current).toBe(2);
  });

  it('does not expose opponent hand contents', () => {
    const state = makeGame();
    const view = createPlayerView(state, 'p1');
    expect(view.players.find((player) => player.playerId === 'p1')?.hand).toEqual(state.players[0].hand);
    expect(view.players.find((player) => player.playerId === 'p2')?.hand).toBeUndefined();
    expect(createPublicView(state).players.every((player) => player.hand === undefined)).toBe(true);
  });

  it('redacts unrevealed front identities and effect metadata', () => {
    const state = makeGame(777);
    const hidden = state.fronts[1]!;
    expect(hidden.revealed).toBe(false);
    const view = createPlayerView(state, 'p1');
    expect(view.fronts[1]!.definition.frontId).toBe('front-slot-2');
    expect(view.fronts[1]!.definition.effectId).toBe('hidden');
    expect(JSON.stringify(view.events)).not.toContain(hidden.definition.frontId);
  });

  it('canonicalizes hidden front slot aliases before recording a turn plan', () => {
    const state = makeGame(778);
    const owner = state.players[0];
    const card = cards[0]!;
    owner.hand = [card.cardId];
    owner.energy = 6;
    const result = submitTurnIntent(state, 'p1', { requestId: 'hidden-slot-plan', turn: state.turn, deployments: [{ cardId: card.cardId, frontId: 'front-slot-2', order: 0 }] });
    expect(result).toEqual({ ok: true });
    expect(owner.intent?.deployments[0]?.frontId).toBe(state.fronts[1]!.definition.frontId);
  });

  it('does not expose an opponent turn plan or deployment count', () => {
    const state = makeGame();
    submitTurnIntent(state, 'p1', { requestId: 'private-plan', turn: 1, deployments: [] });
    expect(createPlayerView(state, 'p1').events.some((event) => event.type === 'turn_plan_updated')).toBe(true);
    expect(createPlayerView(state, 'p2').events.some((event) => event.type === 'turn_plan_updated' || event.type === 'turn_submitted')).toBe(false);
    expect(createPublicView(state).events.some((event) => event.type === 'turn_plan_updated' || event.type === 'turn_submitted')).toBe(false);
  });

  it('replays a complete six-turn game to the identical state', () => {
    const state = makeGame(77);
    raiseBanner(state, 'p1', 'replay-banner');
    while (state.phase !== 'ended') emptyTurn(state);
    expect(replayGameEvents(state)).toEqual(state);
    expect(verifyReplay(state)).toBe(true);
  });

  it('replays withdrawal to the identical result', () => {
    const state = makeGame(17);
    withdraw(state, 'p1', 'replay-withdrawal');
    expect(replayGameEvents(state)).toEqual(state);
  });
});
