import type { AbilityDefinition, AbilityTrigger, CardAbilitySpec, CardDefinition, EffectSpec, TargetSelector } from '../types.js';

type LegacyTemplate = AbilityDefinition & {
  target: TargetSelector;
  effects: (args: Record<string, unknown>) => EffectSpec[];
  conditions?: CardAbilitySpec['conditions'];
};

const amount = (args: Record<string, unknown>, fallback: number): number =>
  typeof args.amount === 'number' && Number.isFinite(args.amount) ? args.amount : fallback;

const legacyTemplates: LegacyTemplate[] = [
  { abilityId: 'deploy_boost_self', trigger: 'deploy', targetRule: 'self', nameZh: '临阵振奋', descriptionZh: '部署：自身战力+2。', target: { type: 'self' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 2) }] },
  { abilityId: 'ongoing_allies', trigger: 'ongoing', targetRule: 'allies_here', nameZh: '同袍阵列', descriptionZh: '持续：此处其他友军战力+1。', target: { type: 'same_front_allies' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 1) }] },
  { abilityId: 'turn_start_gain', trigger: 'turn_start', targetRule: 'owner', nameZh: '筹措军令', descriptionZh: '回合开始：本回合军令+1。', target: { type: 'owner' }, effects: (args) => [{ type: 'gain_energy', amount: amount(args, 1) }] },
  { abilityId: 'turn_end_growth', trigger: 'turn_end', targetRule: 'self', nameZh: '历战成长', descriptionZh: '回合结束：自身战力+1。', target: { type: 'self' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 1) }] },
  { abilityId: 'final_growth', trigger: 'finale', targetRule: 'self', nameZh: '终局决意', descriptionZh: '终局：自身战力+3。', target: { type: 'self' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 3) }] },
  { abilityId: 'move_support', trigger: 'deploy', targetRule: 'adjacent_ally', nameZh: '调遣援军', descriptionZh: '部署：从相邻战线调遣一名友军到此处。', target: { type: 'adjacent_front_allies', count: 1 }, effects: () => [{ type: 'move_card', destination: 'source_front' }] },
  { abilityId: 'recruit_echo', trigger: 'deploy', targetRule: 'owner_deck', nameZh: '征召后备', descriptionZh: '部署：抽一张牌。', target: { type: 'owner' }, effects: (args) => [{ type: 'draw_cards', amount: amount(args, 1) }] },
  { abilityId: 'discard_pressure', trigger: 'deploy', targetRule: 'opponent_hand', nameZh: '断绝文书', descriptionZh: '部署：对手弃置一张手牌。', target: { type: 'opponent' }, effects: (args) => [{ type: 'discard_cards', amount: amount(args, 1) }] },
  { abilityId: 'destroy_weakest', trigger: 'deploy', targetRule: 'weakest_enemy_here', nameZh: '斩将', descriptionZh: '部署：令此处战力最低的敌军阵亡。', target: { type: 'weakest_card', side: 'opponent', scope: 'source_front', count: 1 }, effects: () => [{ type: 'destroy_cards' }] },
  { abilityId: 'return_ally', trigger: 'deploy', targetRule: 'owner_graveyard', nameZh: '复归', descriptionZh: '部署：最早阵亡的友军返回手牌。', target: { type: 'owner_graveyard', count: 1 }, effects: () => [{ type: 'return_to_hand' }] },
  { abilityId: 'lock_front', trigger: 'deploy', targetRule: 'opponent_here', nameZh: '封锁阵门', descriptionZh: '部署：对手不能再向此处部署。', target: { type: 'source_front' }, effects: () => [{ type: 'block_deploy' }] },
  { abilityId: 'reinforce_allies', trigger: 'deploy', targetRule: 'allies_here', nameZh: '增援', descriptionZh: '部署：此处其他友军战力+1。', target: { type: 'same_front_allies' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 1) }] },
  { abilityId: 'weaken_enemies', trigger: 'deploy', targetRule: 'enemies_here', nameZh: '挫锐', descriptionZh: '部署：此处敌军战力-1。', target: { type: 'same_front_enemies' }, effects: (args) => [{ type: 'reduce_power', amount: amount(args, 1) }] },
  { abilityId: 'rearrange', trigger: 'deploy', targetRule: 'owner_board', nameZh: '变阵', descriptionZh: '部署：交换两条战线最早部署的友军。', target: { type: 'all_allies', includeSelf: false, count: 2 }, effects: () => [{ type: 'swap_positions' }] },
  { abilityId: 'copy_ally', trigger: 'deploy', targetRule: 'ally_here', nameZh: '摹写战法', descriptionZh: '部署：复制一名同线友军到手牌。', target: { type: 'same_front_allies', count: 1 }, effects: () => [{ type: 'copy_card' }] },
  { abilityId: 'seize_initiative', trigger: 'deploy', targetRule: 'owner', nameZh: '夺势', descriptionZh: '部署：取得下次揭示的制势权。', target: { type: 'owner' }, effects: () => [{ type: 'seize_initiative' }] },
  { abilityId: 'ambush', trigger: 'on_play', targetRule: 'self', nameZh: '伏兵', descriptionZh: '部署：延迟到下一回合揭示。', target: { type: 'self' }, effects: () => [{ type: 'delay_reveal' }] },
  { abilityId: 'synergy_tag', trigger: 'ongoing', targetRule: 'matching_allies_here', nameZh: '连携', descriptionZh: '持续：每有一名同标签友军，自身战力+1。', target: { type: 'self' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 1), scaleBy: 'matching_tags' }] },
  { abilityId: 'lone_warrior', trigger: 'ongoing', targetRule: 'self', nameZh: '孤军', descriptionZh: '持续：若此处只有自身，战力+3。', target: { type: 'self' }, conditions: [{ type: 'front_card_count', operator: 'equals', value: 1, scope: 'owner' }], effects: (args) => [{ type: 'add_power', amount: amount(args, 3) }] },
  { abilityId: 'command_aura', trigger: 'ongoing', targetRule: 'allies_here', nameZh: '统御', descriptionZh: '持续：此处每名其他友军使自身战力+1。', target: { type: 'self' }, effects: (args) => [{ type: 'add_power', amount: amount(args, 1), scaleBy: 'other_allies' }] }
];

export const ABILITY_DEFINITIONS: AbilityDefinition[] = legacyTemplates.map((template) => ({
  abilityId: template.abilityId,
  trigger: template.trigger,
  targetRule: template.targetRule,
  nameZh: template.nameZh,
  descriptionZh: template.descriptionZh
}));
export const ABILITY_REGISTRY: ReadonlyMap<string, AbilityDefinition> = new Map(ABILITY_DEFINITIONS.map((definition) => [definition.abilityId, definition]));

export function normalizeTrigger(trigger: AbilityTrigger): AbilityTrigger {
  return trigger === 'deploy' ? 'on_deploy' : trigger;
}

export function getCardAbilities(card: CardDefinition): CardAbilitySpec[] {
  if (Array.isArray(card.abilities) && card.abilities.length > 0) {
    return card.abilities.map((ability) => ({ ...ability, trigger: normalizeTrigger(ability.trigger) }));
  }
  const template = legacyTemplates.find((candidate) => candidate.abilityId === card.abilityId);
  if (!template) return [];
  const args = card.abilityArgs ?? {};
  return [{
    abilityId: template.abilityId,
    nameZh: template.nameZh,
    textZh: card.abilityTextZh || template.descriptionZh,
    trigger: normalizeTrigger(template.trigger),
    ...(template.conditions ? { conditions: template.conditions } : {}),
    target: template.target,
    effects: template.effects(args),
    priority: 0
  }];
}
