import { calculateFrontPower } from './engine.js';
import type { CardInstance, GameEvent, GameState, PlayerId } from './types.js';

export interface BattlePlayerStats {
  deployments: number;
  ordersUsed: number;
  unusedOrders: number;
  totalPower: number;
  highestSingleCardPower: number;
  powerGained: number;
  powerReduced: number;
  moves: number;
  deaths: number;
  returns: number;
  discards: number;
  generatedCards: number;
  abilityTriggers: number;
  bannerTurn: number | null;
  withdrawalTurn: number | null;
  controlChanges: number;
}

export interface BattleCardSnapshot {
  instanceId: string;
  cardId: string;
  nameZh: string;
  basePower: number;
  finalPower: number;
  frontId: string;
  revealed: boolean;
  moved: boolean;
  createdByEffect: boolean;
  statuses: string[];
  modifiers: Array<{ source: string; amount: number }>;
}

export interface BattleFrontSummary {
  frontId: string;
  nameZh: string;
  descriptionZh: string;
  revealed: boolean;
  controlPlayerId: string | null;
  powers: Record<string, number>;
  cards: Record<string, BattleCardSnapshot[]>;
}

export type BattleHighlightKind = 'mvp' | 'highest_power' | 'largest_contribution' | 'most_triggers' | 'largest_swing' | 'key_casualty';

export interface BattleCardHighlight {
  kind: BattleHighlightKind;
  playerId: string;
  cardId: string;
  instanceId: string;
  nameZh: string;
  value: number;
  rationaleZh: string;
}

export interface BattleTurningPoint {
  sequence: number;
  turn: number;
  kind: 'power_swing' | 'control_flip' | 'finisher' | 'banner' | 'withdrawal' | 'death' | 'move' | 'finale';
  titleZh: string;
  detailZh: string;
  magnitude: number;
  playerId?: string;
  frontId?: string;
  cardId?: string;
}

export interface BattleTimelineEntry {
  sequence: number;
  turn: number;
  category: 'draw' | 'deploy' | 'reveal' | 'move' | 'ability' | 'power' | 'control' | 'banner' | 'withdrawal' | 'system';
  type: string;
  playerId?: string;
  frontId?: string;
  cardId?: string;
  magnitude?: number;
}

export interface BattlePlayerSummary {
  playerId: string;
  name: string;
  deckId: string;
  deckName: string;
  stats: BattlePlayerStats;
}

export interface BattleSummary {
  schemaVersion: 1;
  gameId: string;
  catalogVersion: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  turns: number;
  winner: GameState['winner'];
  players: BattlePlayerSummary[];
  fronts: BattleFrontSummary[];
  highlights: BattleCardHighlight[];
  mostEffectiveFrontId: string | null;
  turningPoints: BattleTurningPoint[];
  timeline: BattleTimelineEntry[];
  mvpAlgorithmZh: string;
}

export interface BattleSummaryOptions {
  startedAt?: number;
  endedAt?: number;
}

interface CardMetric {
  playerId: string;
  cardId: string;
  instanceId: string;
  nameZh: string;
  basePower: number;
  finalPower: number;
  frontId: string;
  triggers: number;
  positiveDelta: number;
  absoluteDelta: number;
  moves: number;
  died: boolean;
  survivedOnControlledFront: boolean;
}

const numberValue = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';

const eventPlayerId = (event: GameEvent): string => stringValue(event.payload.playerId) || event.playerId || '';
const eventCardId = (event: GameEvent): string => stringValue(event.payload.cardId) || stringValue(event.payload.sourceCardId);
const eventFrontId = (event: GameEvent): string => stringValue(event.payload.frontId) || stringValue(event.payload.to) || stringValue(event.payload.from);

function timelineCategory(type: string): BattleTimelineEntry['category'] {
  if (type.includes('draw')) return 'draw';
  if (type.includes('deploy')) return 'deploy';
  if (type.includes('reveal')) return 'reveal';
  if (type.includes('move') || type === 'formation_changed') return 'move';
  if (type.startsWith('ability_')) return type === 'ability_effect_applied' ? 'power' : 'ability';
  if (type.includes('power') || type === 'stake_changed') return 'power';
  if (type.includes('control') || type === 'turn_resolved') return 'control';
  if (type.includes('banner')) return 'banner';
  if (type.includes('withdrew')) return 'withdrawal';
  return 'system';
}

function cardSnapshot(state: GameState, card: CardInstance): BattleCardSnapshot {
  const definition = state.cardCatalog[card.cardId];
  return {
    instanceId: card.instanceId,
    cardId: card.cardId,
    nameZh: definition?.nameZh ?? card.cardId,
    basePower: definition?.power ?? card.currentPower,
    finalPower: card.currentPower,
    frontId: card.frontId,
    revealed: card.revealed,
    moved: card.moved === true,
    createdByEffect: card.createdByEffect === true,
    statuses: [...(card.statuses ?? [])],
    modifiers: card.modifiers.map((modifier) => ({ source: modifier.source, amount: modifier.amount }))
  };
}

function frontController(powers: Record<string, number>): string | null {
  const entries = Object.entries(powers).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length < 2 || entries[0]![1] === entries[1]![1]) return null;
  return entries[0]![0];
}

function bestMetric(metrics: CardMetric[], score: (metric: CardMetric) => number): CardMetric | undefined {
  return [...metrics].sort((left, right) => score(right) - score(left) || right.finalPower - left.finalPower || left.instanceId.localeCompare(right.instanceId))[0];
}

function makeHighlight(kind: BattleHighlightKind, metric: CardMetric | undefined, value: number, rationaleZh: string): BattleCardHighlight | null {
  if (!metric) return null;
  return { kind, playerId: metric.playerId, cardId: metric.cardId, instanceId: metric.instanceId, nameZh: metric.nameZh, value, rationaleZh };
}

export function createBattleSummary(state: GameState, options: BattleSummaryOptions = {}): BattleSummary {
  const playerIds = state.players.map((player) => player.playerId);
  const stats = new Map<PlayerId, BattlePlayerStats>(playerIds.map((playerId) => [playerId, {
    deployments: 0,
    ordersUsed: 0,
    unusedOrders: 0,
    totalPower: 0,
    highestSingleCardPower: 0,
    powerGained: 0,
    powerReduced: 0,
    moves: 0,
    deaths: 0,
    returns: 0,
    discards: 0,
    generatedCards: 0,
    abilityTriggers: 0,
    bannerTurn: null,
    withdrawalTurn: null,
    controlChanges: 0
  }]));
  const instanceCardIds = new Map<string, string>();
  const instancePlayers = new Map<string, string>();
  const triggerCounts = new Map<string, number>();
  const positiveDeltas = new Map<string, number>();
  const absoluteDeltas = new Map<string, number>();
  const moveCounts = new Map<string, number>();
  const deadInstances = new Set<string>();
  const previousControl = new Map<string, string | null>();
  const turningCandidates: Array<BattleTurningPoint & { score: number }> = [];

  for (const owner of state.players) {
    for (const card of [...Object.values(owner.fronts).flat(), ...owner.graveyard]) {
      instanceCardIds.set(card.instanceId, card.cardId);
      instancePlayers.set(card.instanceId, owner.playerId);
    }
  }

  for (const event of state.eventLog) {
    const playerId = eventPlayerId(event);
    const playerStats = stats.get(playerId);
    const instanceId = stringValue(event.payload.instanceId) || stringValue(event.payload.sourceInstanceId);
    const cardId = eventCardId(event) || instanceCardIds.get(instanceId) || '';
    if (instanceId && cardId) instanceCardIds.set(instanceId, cardId);
    if (instanceId && playerId) instancePlayers.set(instanceId, playerId);

    if (event.type === 'card_deployed' && playerStats) {
      playerStats.deployments += 1;
      playerStats.ordersUsed += numberValue(event.payload.cost);
      const cost = numberValue(event.payload.baseCost ?? event.payload.cost);
      if (cost >= 5) turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'finisher', titleZh: '重将入阵', detailZh: `${state.cardCatalog[cardId]?.nameZh ?? '高费角色'}投入战场`, magnitude: cost, playerId, frontId: eventFrontId(event), cardId, score: 58 + cost });
    }
    if (event.type === 'turn_resolved') {
      const unused = event.payload.unusedOrders;
      if (unused && typeof unused === 'object') for (const [id, amount] of Object.entries(unused as Record<string, unknown>)) {
        const target = stats.get(id);
        if (target) target.unusedOrders += numberValue(amount);
      }
      const control = event.payload.control;
      if (control && typeof control === 'object') for (const [frontId, controllerValue] of Object.entries(control as Record<string, unknown>)) {
        const controller = typeof controllerValue === 'string' ? controllerValue : null;
        const prior = previousControl.get(frontId) ?? null;
        if (controller !== prior) {
          if (controller) stats.get(controller)!.controlChanges += 1;
          if (previousControl.has(frontId)) turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'control_flip', titleZh: '战线易手', detailZh: `${state.fronts.find((front) => front.definition.frontId === frontId)?.definition.nameZh ?? frontId}控制权发生变化`, magnitude: 6, ...(controller ? { playerId: controller } : {}), frontId, score: 76 });
        }
        previousControl.set(frontId, controller);
      }
    }
    if (event.type === 'card_moved' && playerStats) {
      playerStats.moves += 1;
      if (instanceId) moveCounts.set(instanceId, (moveCounts.get(instanceId) ?? 0) + 1);
      turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'move', titleZh: '关键调遣', detailZh: '角色改变战线部署位置', magnitude: 2, playerId, frontId: eventFrontId(event), ...(cardId ? { cardId } : {}), score: 28 });
    }
    if (event.type === 'card_destroyed' && playerStats) {
      playerStats.deaths += 1;
      if (instanceId) deadInstances.add(instanceId);
      const power = state.cardCatalog[cardId]?.power ?? 0;
      turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'death', titleZh: '关键阵亡', detailZh: `${state.cardCatalog[cardId]?.nameZh ?? '角色'}退出战线`, magnitude: power, playerId, frontId: eventFrontId(event), cardId, score: 38 + power });
    }
    if ((event.type === 'card_returned' || event.type === 'card_revived') && playerStats) playerStats.returns += 1;
    if (event.type === 'card_discarded' && playerStats) playerStats.discards += 1;
    if ((event.type === 'card_copied' || event.type === 'card_generated') && playerStats) playerStats.generatedCards += numberValue(event.payload.count, 1);
    if (event.type === 'ability_started' && playerStats) {
      playerStats.abilityTriggers += 1;
      if (instanceId) triggerCounts.set(instanceId, (triggerCounts.get(instanceId) ?? 0) + 1);
    }
    if (event.type === 'ability_effect_applied') {
      const deltas = Array.isArray(event.payload.deltas) ? event.payload.deltas : [];
      let magnitude = 0;
      for (const rawDelta of deltas) {
        if (!rawDelta || typeof rawDelta !== 'object') continue;
        const delta = rawDelta as Record<string, unknown>;
        const targetPlayerId = stringValue(delta.playerId);
        const targetInstanceId = stringValue(delta.instanceId);
        const amount = numberValue(delta.amount);
        const targetStats = stats.get(targetPlayerId);
        if (targetStats) {
          if (amount > 0) targetStats.powerGained += amount;
          if (amount < 0) targetStats.powerReduced += Math.abs(amount);
        }
        if (targetInstanceId) {
          positiveDeltas.set(targetInstanceId, (positiveDeltas.get(targetInstanceId) ?? 0) + Math.max(0, amount));
          absoluteDeltas.set(targetInstanceId, (absoluteDeltas.get(targetInstanceId) ?? 0) + Math.abs(amount));
        }
        magnitude += Math.abs(amount);
      }
      if (magnitude > 0) turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'power_swing', titleZh: '战力突变', detailZh: `一次技能造成 ${magnitude} 点战力变化`, magnitude, ...(playerId ? { playerId } : {}), ...(eventFrontId(event) ? { frontId: eventFrontId(event) } : {}), ...(cardId ? { cardId } : {}), score: 45 + magnitude });
    }
    if (event.type === 'banner_raised' && playerStats) {
      playerStats.bannerTurn = event.turn;
      turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'banner', titleZh: '举旗加注', detailZh: '战功上限提升，双方进入更高风险对抗', magnitude: numberValue(event.payload.pending), playerId, score: 92 });
    }
    if (event.type === 'player_withdrew' && playerStats) {
      playerStats.withdrawalTurn = event.turn;
      turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'withdrawal', titleZh: '主动撤军', detailZh: '对局以撤军结算', magnitude: numberValue(event.payload.stake), playerId, score: 110 });
    }
    if (event.type === 'game_ended') turningCandidates.push({ sequence: event.sequence, turn: event.turn, kind: 'finale', titleZh: '终局判定', detailZh: '三条战线完成最终锁定', magnitude: state.winner?.stake ?? 0, score: 65 });
  }

  const fronts: BattleFrontSummary[] = state.fronts.map((front) => {
    const powers = Object.fromEntries(state.players.map((owner) => [owner.playerId, calculateFrontPower(state, owner.playerId, front.definition.frontId)]));
    return {
      frontId: front.definition.frontId,
      nameZh: front.definition.nameZh,
      descriptionZh: front.definition.descriptionZh,
      revealed: front.revealed,
      controlPlayerId: frontController(powers),
      powers,
      cards: Object.fromEntries(state.players.map((owner) => [owner.playerId, (owner.fronts[front.definition.frontId] ?? []).map((card) => cardSnapshot(state, card))]))
    };
  });

  const metrics: CardMetric[] = state.players.flatMap((owner) => {
    const cards = [...Object.values(owner.fronts).flat(), ...owner.graveyard];
    return cards.map((card) => {
      const definition = state.cardCatalog[card.cardId];
      const controlled = fronts.find((front) => front.frontId === card.frontId)?.controlPlayerId === owner.playerId;
      return {
        playerId: owner.playerId,
        cardId: card.cardId,
        instanceId: card.instanceId,
        nameZh: definition?.nameZh ?? card.cardId,
        basePower: definition?.power ?? card.currentPower,
        finalPower: card.currentPower,
        frontId: card.frontId,
        triggers: triggerCounts.get(card.instanceId) ?? 0,
        positiveDelta: positiveDeltas.get(card.instanceId) ?? 0,
        absoluteDelta: absoluteDeltas.get(card.instanceId) ?? 0,
        moves: moveCounts.get(card.instanceId) ?? 0,
        died: deadInstances.has(card.instanceId),
        survivedOnControlledFront: controlled && !deadInstances.has(card.instanceId)
      };
    });
  });

  for (const playerId of playerIds) {
    const playerMetrics = metrics.filter((metric) => metric.playerId === playerId && !metric.died);
    const playerStats = stats.get(playerId)!;
    playerStats.totalPower = fronts.reduce((sum, front) => sum + (front.powers[playerId] ?? 0), 0);
    playerStats.highestSingleCardPower = playerMetrics.reduce((highest, metric) => Math.max(highest, metric.finalPower), 0);
  }

  const mvpScore = (metric: CardMetric): number => metric.finalPower + metric.positiveDelta + metric.triggers * 2 + metric.moves + (metric.survivedOnControlledFront ? 3 : 0) - (metric.died ? 2 : 0);
  const mvp = bestMetric(metrics, mvpScore);
  const highestPower = bestMetric(metrics.filter((metric) => !metric.died), (metric) => metric.finalPower);
  const contribution = bestMetric(metrics, (metric) => metric.finalPower - metric.basePower + metric.positiveDelta);
  const mostTriggers = bestMetric(metrics, (metric) => metric.triggers);
  const largestSwing = bestMetric(metrics, (metric) => metric.absoluteDelta);
  const keyCasualty = bestMetric(metrics.filter((metric) => metric.died), (metric) => metric.basePower + metric.triggers * 2);
  const highlights = [
    makeHighlight('mvp', mvp, mvp ? mvpScore(mvp) : 0, '按终局战力、正向战力贡献、技能触发、调遣、控线存活与阵亡惩罚综合计算'),
    makeHighlight('highest_power', highestPower, highestPower?.finalPower ?? 0, '终局仍在战场上的最高单卡战力'),
    makeHighlight('largest_contribution', contribution, contribution ? contribution.finalPower - contribution.basePower + contribution.positiveDelta : 0, '终局增量与事件记录中的正向战力变化之和'),
    makeHighlight('most_triggers', mostTriggers, mostTriggers?.triggers ?? 0, '确定性事件日志中技能开始事件最多'),
    makeHighlight('largest_swing', largestSwing, largestSwing?.absoluteDelta ?? 0, '技能事件造成的累计绝对战力变化最大'),
    makeHighlight('key_casualty', keyCasualty, keyCasualty ? keyCasualty.basePower + keyCasualty.triggers * 2 : 0, '已阵亡角色中基础战力与技能影响最高')
  ].filter((highlight): highlight is BattleCardHighlight => Boolean(highlight));

  const mostEffectiveFront = [...fronts].sort((left, right) => {
    const leftValues = Object.values(left.powers).sort((a, b) => b - a);
    const rightValues = Object.values(right.powers).sort((a, b) => b - a);
    return (rightValues[0]! - rightValues[1]!) - (leftValues[0]! - leftValues[1]!) || left.frontId.localeCompare(right.frontId);
  })[0];
  const chosenTurningPoints = [...new Map(turningCandidates.sort((left, right) => right.score - left.score || left.sequence - right.sequence).map((point) => [`${point.sequence}:${point.kind}:${point.frontId ?? ''}`, point])).values()]
    .slice(0, 5)
    .sort((left, right) => left.sequence - right.sequence)
    .map((point): BattleTurningPoint => ({
      sequence: point.sequence,
      turn: point.turn,
      kind: point.kind,
      titleZh: point.titleZh,
      detailZh: point.detailZh,
      magnitude: point.magnitude,
      ...(point.playerId ? { playerId: point.playerId } : {}),
      ...(point.frontId ? { frontId: point.frontId } : {}),
      ...(point.cardId ? { cardId: point.cardId } : {})
    }));
  const timeline = state.eventLog.filter((event) => event.public).map((event): BattleTimelineEntry => {
    const playerId = eventPlayerId(event);
    const frontId = eventFrontId(event);
    const cardId = eventCardId(event);
    const magnitude = event.type === 'ability_effect_applied' && Array.isArray(event.payload.deltas)
      ? event.payload.deltas.reduce((sum, delta) => sum + Math.abs(numberValue((delta as Record<string, unknown>)?.amount)), 0)
      : undefined;
    return {
      sequence: event.sequence,
      turn: event.turn,
      category: timelineCategory(event.type),
      type: event.type,
      ...(playerId ? { playerId } : {}),
      ...(frontId ? { frontId } : {}),
      ...(cardId ? { cardId } : {}),
      ...(magnitude !== undefined ? { magnitude } : {})
    };
  });
  const startedAt = options.startedAt ?? null;
  const endedAt = options.endedAt ?? null;

  return {
    schemaVersion: 1,
    gameId: state.gameId,
    catalogVersion: state.setup.catalogVersion ?? 'unknown',
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0,
    turns: state.turn,
    winner: state.winner ? JSON.parse(JSON.stringify(state.winner)) as GameState['winner'] : null,
    players: state.players.map((owner) => {
      const setup = state.setup.players.find((player) => player.playerId === owner.playerId);
      return { playerId: owner.playerId, name: owner.name, deckId: setup?.deckId ?? 'unknown', deckName: setup?.deckName ?? '未命名牌组', stats: stats.get(owner.playerId)! };
    }),
    fronts,
    highlights,
    mostEffectiveFrontId: mostEffectiveFront?.frontId ?? null,
    turningPoints: chosenTurningPoints,
    timeline,
    mvpAlgorithmZh: '主将分数 = 终局战力 + 事件正向战力贡献 + 技能触发次数×2 + 调遣次数 + 控制战线存活奖励3 - 阵亡惩罚2；同分依次比较终局战力与实例编号。'
  };
}
