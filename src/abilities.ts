import {
  MAX_TRIGGER_DEPTH,
  RuleError,
  type AbilityContext,
  type AbilityDefinition,
  type CardInstance,
  type GameEvent,
  type PlayerState
} from './types.js';

export type AbilityHandler = (context: AbilityContext) => void;

interface RegisteredAbility extends AbilityDefinition {
  handler: AbilityHandler;
}

const amount = (context: AbilityContext, fallback: number): number => {
  const definition = context.gameState.cardCatalog[context.sourceCardId];
  const value = definition?.abilityArgs?.amount;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const player = (context: AbilityContext): PlayerState => {
  const result = context.gameState.players.find((item) => item.playerId === context.sourcePlayerId);
  if (!result) throw new RuleError('PLAYER_NOT_FOUND', 'Ability source player does not exist.');
  return result;
};

const opponent = (context: AbilityContext): PlayerState => {
  const result = context.gameState.players.find((item) => item.playerId !== context.sourcePlayerId);
  if (!result) throw new RuleError('OPPONENT_NOT_FOUND', 'Ability opponent does not exist.');
  return result;
};

const instance = (context: AbilityContext): CardInstance => {
  for (const owner of context.gameState.players) {
    for (const cards of Object.values(owner.fronts)) {
      const found = cards.find((item) => item.instanceId === context.sourceInstanceId);
      if (found) return found;
    }
  }
  throw new RuleError('SOURCE_LEFT_PLAY', 'Ability source is no longer in play.');
};

const emit = (context: AbilityContext, type: string, payload: Record<string, unknown>): void => {
  const event: GameEvent = {
    sequence: 0,
    type,
    turn: context.turn,
    playerId: context.sourcePlayerId,
    public: true,
    payload: { sourceInstanceId: context.sourceInstanceId, ...payload }
  };
  context.eventQueue.push(event);
};

const boostSelf: AbilityHandler = (context) => {
  const source = instance(context);
  const value = amount(context, 2);
  source.currentPower += value;
  source.modifiers.push({ source: context.sourceCardId, amount: value });
  emit(context, 'power_changed', { instanceId: source.instanceId, amount: value });
};

const boostAllies: AbilityHandler = (context) => {
  const owner = player(context);
  const allies = owner.fronts[context.sourceFrontId ?? ''] ?? [];
  const value = amount(context, 1);
  for (const ally of allies) {
    if (ally.instanceId === context.sourceInstanceId) continue;
    ally.currentPower += value;
    ally.modifiers.push({ source: context.sourceCardId, amount: value });
  }
  emit(context, 'allies_reinforced', { frontId: context.sourceFrontId, amount: value, count: Math.max(0, allies.length - 1) });
};

const gainEnergy: AbilityHandler = (context) => {
  const owner = player(context);
  const value = amount(context, 1);
  owner.energy += value;
  emit(context, 'energy_changed', { amount: value });
};

const grow: AbilityHandler = (context) => boostSelf(context);

const moveSupport: AbilityHandler = (context) => {
  const owner = player(context);
  const sourceFrontIndex = context.gameState.fronts.findIndex((item) => item.definition.frontId === context.sourceFrontId);
  if (sourceFrontIndex < 0) return;
  const candidateIndexes = [sourceFrontIndex - 1, sourceFrontIndex + 1].filter((index) => index >= 0 && index < context.gameState.fronts.length);
  for (const index of candidateIndexes) {
    const originId = context.gameState.fronts[index]?.definition.frontId;
    if (!originId) continue;
    const origin = owner.fronts[originId] ?? [];
    const moving = origin.find((item) => item.revealed);
    if (!moving || !context.sourceFrontId) continue;
    owner.fronts[originId] = origin.filter((item) => item.instanceId !== moving.instanceId);
    moving.frontId = context.sourceFrontId;
    owner.fronts[context.sourceFrontId]?.push(moving);
    emit(context, 'card_moved', { instanceId: moving.instanceId, from: originId, to: context.sourceFrontId });
    return;
  }
};

const recruit: AbilityHandler = (context) => {
  const owner = player(context);
  const value = Math.max(1, Math.floor(amount(context, 1)));
  const drawn = owner.deck.splice(0, value);
  owner.hand.push(...drawn);
  emit(context, 'cards_recruited', { count: drawn.length });
};

const discard: AbilityHandler = (context) => {
  const target = opponent(context);
  const discarded = target.hand.shift();
  emit(context, 'card_discarded', { targetPlayerId: target.playerId, cardId: discarded ?? null });
};

const destroyWeakest: AbilityHandler = (context) => {
  if (!context.sourceFrontId) return;
  const target = opponent(context);
  const lane = target.fronts[context.sourceFrontId] ?? [];
  const victim = [...lane]
    .filter((item) => item.revealed)
    .sort((left, right) => left.currentPower - right.currentPower || left.instanceId.localeCompare(right.instanceId))[0];
  if (!victim) return;
  target.fronts[context.sourceFrontId] = lane.filter((item) => item.instanceId !== victim.instanceId);
  target.graveyard.push(victim);
  emit(context, 'card_destroyed', { targetPlayerId: target.playerId, instanceId: victim.instanceId });
};

const returnAlly: AbilityHandler = (context) => {
  const owner = player(context);
  const restored = owner.graveyard.shift();
  if (!restored) return;
  owner.hand.push(restored.cardId);
  emit(context, 'card_returned', { cardId: restored.cardId });
};

const lockFront: AbilityHandler = (context) => {
  const front = context.gameState.fronts.find((item) => item.definition.frontId === context.sourceFrontId);
  const target = opponent(context);
  if (!front) return;
  front.blockedFor = target.playerId;
  emit(context, 'front_blocked', { frontId: context.sourceFrontId, targetPlayerId: target.playerId });
};

const weakenEnemies: AbilityHandler = (context) => {
  if (!context.sourceFrontId) return;
  const enemies = opponent(context).fronts[context.sourceFrontId] ?? [];
  const value = Math.abs(amount(context, 1));
  for (const enemy of enemies) {
    enemy.currentPower -= value;
    enemy.modifiers.push({ source: context.sourceCardId, amount: -value });
  }
  emit(context, 'enemies_weakened', { frontId: context.sourceFrontId, amount: value, count: enemies.length });
};

const rearrange: AbilityHandler = (context) => {
  const owner = player(context);
  const lanes = context.gameState.fronts.map((item) => item.definition.frontId);
  const occupied = lanes.filter((id) => (owner.fronts[id]?.length ?? 0) > 0);
  if (occupied.length < 2) return;
  const firstId = occupied[0] as string;
  const secondId = occupied[1] as string;
  const first = owner.fronts[firstId]?.[0];
  const second = owner.fronts[secondId]?.[0];
  if (!first || !second) return;
  owner.fronts[firstId]![0] = second;
  owner.fronts[secondId]![0] = first;
  first.frontId = secondId;
  second.frontId = firstId;
  emit(context, 'formation_changed', { firstInstanceId: first.instanceId, secondInstanceId: second.instanceId });
};

const copyAlly: AbilityHandler = (context) => {
  if (!context.sourceFrontId) return;
  const owner = player(context);
  const ally = owner.fronts[context.sourceFrontId]?.find((item) => item.instanceId !== context.sourceInstanceId);
  if (!ally) return;
  owner.hand.push(ally.cardId);
  emit(context, 'card_copied', { cardId: ally.cardId });
};

const seizeInitiative: AbilityHandler = (context) => {
  context.gameState.initiativePlayerId = context.sourcePlayerId;
  emit(context, 'initiative_seized', { playerId: context.sourcePlayerId });
};

const noImmediateMutation: AbilityHandler = (context) => {
  emit(context, 'ability_registered', { abilityId: context.gameState.cardCatalog[context.sourceCardId]?.abilityId ?? 'unknown' });
};

const definitions: Array<Omit<RegisteredAbility, 'handler'> & { handler: AbilityHandler }> = [
  { abilityId: 'deploy_boost_self', trigger: 'deploy', targetRule: 'self', nameZh: '临阵振奋', descriptionZh: '部署：自身战力+2。', handler: boostSelf },
  { abilityId: 'ongoing_allies', trigger: 'ongoing', targetRule: 'allies_here', nameZh: '同袍阵列', descriptionZh: '持续：此处其他友军战力+1。', handler: noImmediateMutation },
  { abilityId: 'turn_start_gain', trigger: 'turn_start', targetRule: 'owner', nameZh: '筹措军令', descriptionZh: '回合开始：本回合军令+1。', handler: gainEnergy },
  { abilityId: 'turn_end_growth', trigger: 'turn_end', targetRule: 'self', nameZh: '历战成长', descriptionZh: '回合结束：自身战力+1。', handler: grow },
  { abilityId: 'final_growth', trigger: 'finale', targetRule: 'self', nameZh: '终局决意', descriptionZh: '终局：自身战力+3。', handler: grow },
  { abilityId: 'move_support', trigger: 'deploy', targetRule: 'adjacent_ally', nameZh: '调遣援军', descriptionZh: '部署：从相邻战线调遣一名友军到此处。', handler: moveSupport },
  { abilityId: 'recruit_echo', trigger: 'deploy', targetRule: 'owner_deck', nameZh: '征召后备', descriptionZh: '部署：抽一张牌。', handler: recruit },
  { abilityId: 'discard_pressure', trigger: 'deploy', targetRule: 'opponent_hand', nameZh: '断绝文书', descriptionZh: '部署：对手弃置一张手牌。', handler: discard },
  { abilityId: 'destroy_weakest', trigger: 'deploy', targetRule: 'weakest_enemy_here', nameZh: '斩将', descriptionZh: '部署：令此处战力最低的敌军阵亡。', handler: destroyWeakest },
  { abilityId: 'return_ally', trigger: 'deploy', targetRule: 'owner_graveyard', nameZh: '复归', descriptionZh: '部署：最早阵亡的友军返回手牌。', handler: returnAlly },
  { abilityId: 'lock_front', trigger: 'deploy', targetRule: 'opponent_here', nameZh: '封锁阵门', descriptionZh: '部署：对手不能再向此处部署。', handler: lockFront },
  { abilityId: 'reinforce_allies', trigger: 'deploy', targetRule: 'allies_here', nameZh: '增援', descriptionZh: '部署：此处其他友军战力+1。', handler: boostAllies },
  { abilityId: 'weaken_enemies', trigger: 'deploy', targetRule: 'enemies_here', nameZh: '挫锐', descriptionZh: '部署：此处敌军战力-1。', handler: weakenEnemies },
  { abilityId: 'rearrange', trigger: 'deploy', targetRule: 'owner_board', nameZh: '变阵', descriptionZh: '部署：交换两条战线最早部署的友军。', handler: rearrange },
  { abilityId: 'copy_ally', trigger: 'deploy', targetRule: 'ally_here', nameZh: '摹写战法', descriptionZh: '部署：复制一名同线友军到手牌。', handler: copyAlly },
  { abilityId: 'seize_initiative', trigger: 'deploy', targetRule: 'owner', nameZh: '夺势', descriptionZh: '部署：取得下次揭示的制势权。', handler: seizeInitiative },
  { abilityId: 'ambush', trigger: 'deploy', targetRule: 'self', nameZh: '伏兵', descriptionZh: '部署：延迟到下一回合揭示。', handler: noImmediateMutation },
  { abilityId: 'synergy_tag', trigger: 'ongoing', targetRule: 'matching_allies_here', nameZh: '连携', descriptionZh: '持续：每有一名同标签友军，自身战力+1。', handler: noImmediateMutation },
  { abilityId: 'lone_warrior', trigger: 'ongoing', targetRule: 'self', nameZh: '孤军', descriptionZh: '持续：若此处只有自身，战力+3。', handler: noImmediateMutation },
  { abilityId: 'command_aura', trigger: 'ongoing', targetRule: 'allies_here', nameZh: '统御', descriptionZh: '持续：此处每名其他友军使自身战力+1。', handler: noImmediateMutation }
];

export const ABILITY_REGISTRY: ReadonlyMap<string, RegisteredAbility> = new Map(
  definitions.map((definition) => [definition.abilityId, definition])
);

export const ABILITY_DEFINITIONS: AbilityDefinition[] = definitions.map((definition) => ({
  abilityId: definition.abilityId,
  trigger: definition.trigger,
  targetRule: definition.targetRule,
  nameZh: definition.nameZh,
  descriptionZh: definition.descriptionZh
}));

export function resolveAbility(context: AbilityContext): GameEvent[] {
  if (context.depth > MAX_TRIGGER_DEPTH) {
    throw new RuleError('TRIGGER_DEPTH_EXCEEDED', 'Ability trigger depth exceeded.', { depth: context.depth });
  }
  const source = instance(context);
  if (source.silenced) return [];
  const card = context.gameState.cardCatalog[context.sourceCardId];
  if (!card) throw new RuleError('UNKNOWN_CARD', 'Ability source card is unknown.');
  const registered = ABILITY_REGISTRY.get(card.abilityId);
  if (!registered) throw new RuleError('UNKNOWN_ABILITY', `Unknown ability: ${card.abilityId}`);
  registered.handler(context);
  return context.eventQueue;
}
