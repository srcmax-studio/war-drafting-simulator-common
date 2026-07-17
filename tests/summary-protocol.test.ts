import { describe, expect, it } from 'vitest';
import {
  DECK_SIZE,
  FRONT_DEFINITIONS,
  PROTOCOL_VERSION,
  createBattleSummary,
  createGame,
  getEffectiveCost,
  getFrontCapacity,
  isClientAction,
  lockTurn,
  raiseBanner,
  submitTurnIntent,
  validateClientAction,
  withdraw,
  type CardDefinition,
  type GameState
} from '../src/index.js';

const cards: CardDefinition[] = Array.from({ length: DECK_SIZE * 2 }, (_, index) => ({
  cardId: `summary-card-${index}`,
  characterUid: String(index),
  characterId: `SUMMARY-${index}`,
  slug: `summary-card-${index}`,
  nameZh: `战史角色${index}`,
  cost: 1,
  power: 2 + index % 5,
  abilityId: 'deploy_boost_self',
  abilityArgs: { amount: 2 },
  abilityTextZh: '部署：自身战力+2。',
  trigger: 'deploy',
  targetRule: 'self',
  faction: '测试',
  era: '古典时代',
  region: '东亚',
  profession: '将领',
  identity: '统帅',
  rarity: 'B级',
  description: '用于结算摘要测试。',
  sourceAbility: '结算测试',
  tags: ['测试'],
  set: 'core',
  version: 1
}));

const makeGame = (): GameState => createGame({
  gameId: 'summary-test',
  seed: 20260717,
  cards,
  fronts: FRONT_DEFINITIONS,
  catalogVersion: 'summary-catalog',
  players: [
    { playerId: 'p1', name: '甲', deck: cards.slice(0, DECK_SIZE).map((card) => card.cardId), deckId: 'deck-a', deckName: '甲阵' },
    { playerId: 'p2', name: '乙', deck: cards.slice(DECK_SIZE).map((card) => card.cardId), deckId: 'deck-b', deckName: '乙阵' }
  ]
});

function submitOneAffordableCard(state: GameState, playerId: string): void {
  const player = state.players.find((candidate) => candidate.playerId === playerId)!;
  const cardId = player.hand[0];
  const card = cardId ? state.cardCatalog[cardId] : undefined;
  const front = card ? state.fronts.find((candidate) => {
    const effect = candidate.definition.effectId;
    return effect !== 'ban_low_cost'
      && getEffectiveCost(state, card, candidate.definition.frontId, playerId) <= player.energy
      && (player.fronts[candidate.definition.frontId]?.length ?? 0) < getFrontCapacity(state, playerId, candidate.definition.frontId);
  }) : undefined;
  const deployments = card && front ? [{ cardId: card.cardId, frontId: front.definition.frontId, order: 0 }] : [];
  expect(submitTurnIntent(state, playerId, { requestId: `plan-${state.turn}-${playerId}`, turn: state.turn, deployments }).ok).toBe(true);
}

describe('release protocol validation', () => {
  it('accepts lobby room creation and rejects oversized chat', () => {
    expect(isClientAction({
      action: 'createRoom',
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'room-1',
      room: { name: '公开演武', visibility: 'public', allowSpectators: false, turnDurationMs: 45_000, packIds: ['core'], tags: ['标准'], revealDecks: false }
    })).toBe(true);
    expect(validateClientAction({ action: 'sendLobbyChat', protocolVersion: PROTOCOL_VERSION, requestId: 'chat-1', message: '甲'.repeat(301) })).toContain('Invalid chat message.');
  });
});

describe('deterministic battle summary', () => {
  it('derives statistics, highlights, turning points and timeline from resolved events', () => {
    const state = makeGame();
    expect(raiseBanner(state, 'p1', 'banner-1').ok).toBe(true);
    while (state.phase !== 'ended') {
      submitOneAffordableCard(state, 'p1');
      submitOneAffordableCard(state, 'p2');
      const turn = state.turn;
      expect(lockTurn(state, 'p1', `lock-${turn}-p1`).ok).toBe(true);
      expect(lockTurn(state, 'p2', `lock-${turn}-p2`).ok).toBe(true);
    }
    const summary = createBattleSummary(state, { startedAt: 1_000, endedAt: 91_000 });
    expect(summary.durationMs).toBe(90_000);
    expect(summary.players).toHaveLength(2);
    expect(summary.players.find((player) => player.playerId === 'p1')?.stats.deployments).toBeGreaterThan(0);
    expect(summary.players.find((player) => player.playerId === 'p1')?.stats.bannerTurn).toBe(1);
    expect(summary.fronts).toHaveLength(3);
    expect(summary.highlights.some((highlight) => highlight.kind === 'mvp')).toBe(true);
    expect(summary.turningPoints.length).toBeGreaterThanOrEqual(3);
    expect(summary.timeline.some((event) => event.type === 'final_state_locked')).toBe(true);
    expect(summary.timeline.every((event, index) => index === 0 || event.sequence > summary.timeline[index - 1]!.sequence)).toBe(true);
  });

  it('records withdrawal timing without inventing a full six-turn result', () => {
    const state = makeGame();
    expect(withdraw(state, 'p2', 'withdraw-p2').ok).toBe(true);
    const summary = createBattleSummary(state);
    expect(summary.turns).toBe(1);
    expect(summary.players.find((player) => player.playerId === 'p2')?.stats.withdrawalTurn).toBe(1);
    expect(summary.turningPoints.some((point) => point.kind === 'withdrawal')).toBe(true);
  });
});
