import type { FrontDefinition } from './types.js';

const front = (
  frontId: string,
  nameZh: string,
  nameEn: string,
  descriptionZh: string,
  descriptionEn: string,
  effectId: string,
  effectArgs: Record<string, unknown>,
  tags: string[],
  strategyZh: string
): FrontDefinition => ({
  frontId,
  nameZh,
  nameEn,
  descriptionZh,
  descriptionEn,
  effectId,
  effectArgs,
  enabled: true,
  weight: 1,
  tags,
  strategyZh
});

export const FRONT_DEFINITIONS: FrontDefinition[] = [
  front('bronze-road', '青铜驿道', 'Bronze Relay', '在此部署的卡牌费用降低1，最低为1。', 'Cards deployed here cost 1 less, to a minimum of 1.', 'cost_down', { amount: 1 }, ['军令', '节奏'], '适合提前展开高费角色。'),
  front('taxed-crossing', '榷税渡口', 'Levy Crossing', '在此部署的卡牌费用提高1。', 'Cards deployed here cost 1 more.', 'cost_up', { amount: 1 }, ['军令', '风险'], '保留军令，避免在同一回合拥堵。'),
  front('signal-ridge', '烽讯高地', 'Signal Ridge', '此处卡牌最终战力+2。', 'Cards here have +2 final power.', 'base_power_up', { amount: 2 }, ['战力'], '低费铺场可放大固定增益。'),
  front('salt-marsh', '白盐泽', 'White Salt Marsh', '此处卡牌最终战力-2。', 'Cards here have -2 final power.', 'base_power_down', { amount: 2 }, ['战力', '风险'], '优先投入能承受减益的高战力角色。'),
  front('age-archive', '纪元档案馆', 'Archive of Ages', '神话时代角色战力+3。', 'Mythic-era cards have +3 power.', 'era_bonus', { era: '神话时代', amount: 3 }, ['时代', '连携'], '围绕指定时代构筑可获得稳定优势。'),
  front('eastern-meridian', '东陆经纬台', 'Eastern Meridian', '东亚角色战力+3。', 'East Asian cards have +3 power.', 'region_bonus', { region: '东亚', amount: 3 }, ['地区', '连携'], '地区密度越高，收益越可靠。'),
  front('artificer-yard', '百工营造司', 'Artificer Yard', '建设类职业角色战力+3。', 'Builder cards have +3 power.', 'profession_bonus', { professionIncludes: '建', amount: 3 }, ['职业', '连携'], '建设者可在此形成坚固阵地。'),
  front('crown-court', '列王议庭', 'Court of Crowns', '君主与皇帝身份角色战力+3。', 'Rulers have +3 power.', 'identity_bonus', { identities: ['君主', '皇帝', '国王', '法老'], amount: 3 }, ['身份', '统御'], '统治者牌组应争夺此处。'),
  front('westward-current', '西迁风道', 'Westward Current', '回合结束时，各方最右侧一张牌向左调遣。', 'At turn end, each side moves its rightmost card one front left.', 'move_left', {}, ['调遣', '位置'], '预判移动后的位置再部署。'),
  front('broken-compass', '失准罗盘场', 'Broken Compass', '回合结束时，各方随机一张牌调遣到相邻战线。', 'At turn end, one random card per side moves to an adjacent front.', 'random_move', {}, ['调遣', '风险'], '分散战力可降低随机调遣的损失。'),
  front('muster-gate', '万民征集门', 'Muster Gate', '回合结束时，在此有牌的玩家抽一张牌。', 'At turn end, players with a card here draw one card.', 'recruit', { count: 1 }, ['征召', '手牌'], '尽早占领可持续补充手牌。'),
  front('mirror-foundry', '镜铸工坊', 'Mirror Foundry', '首次在此部署时，生成一张该牌的基础复制到手牌。', 'The first card played here creates a base copy in hand.', 'copy', {}, ['复制', '资源'], '优先复制高价值或低费角色。'),
  front('sealed-dispatch', '封缄驿站', 'Sealed Dispatch', '回合结束时，手牌最多的玩家弃置一张牌。', 'At turn end, the player with the most cards discards one.', 'discard', { count: 1 }, ['弃置', '手牌'], '控制手牌数量，避免成为唯一目标。'),
  front('execution-ground', '断旌刑场', 'Bannerfall Ground', '回合结束时，此处战力最低的已揭示卡牌阵亡。', 'At turn end, the lowest-power revealed card here is destroyed.', 'destroy', {}, ['阵亡', '风险'], '不要留下孤立的低战力目标。'),
  front('returning-shore', '归帆古岸', 'Returning Shore', '回合结束时，各方复归一张最早阵亡的卡牌到手牌。', 'At turn end, each side returns its oldest fallen card to hand.', 'return', {}, ['复归', '资源'], '主动阵亡可转化为后续手牌。'),
  front('wide-formation', '开阔阵原', 'Open Formation', '每名玩家在此容量+1。', 'Each player has +1 capacity here.', 'capacity_up', { amount: 1 }, ['容量', '铺场'], '适合多卡连携与满场奖励。'),
  front('narrow-pass', '一线天关', 'Needle Pass', '每名玩家在此容量-1。', 'Each player has 1 less capacity here.', 'capacity_down', { amount: 1 }, ['容量', '封锁'], '高质量单卡比铺场更重要。'),
  front('light-foot-ward', '轻骑戒域', 'Lightfoot Ward', '费用4及以上的卡牌不能部署于此。', 'Cards costing 4 or more cannot be deployed here.', 'ban_high_cost', { threshold: 4 }, ['部署限制'], '用低费曲线争夺战线。'),
  front('heavy-standard', '重旌禁区', 'Heavy Standard', '费用2及以下的卡牌不能部署于此。', 'Cards costing 2 or less cannot be deployed here.', 'ban_low_cost', { threshold: 2 }, ['部署限制'], '预留中高费角色。'),
  front('silent-obelisk', '无铭碑林', 'Nameless Steles', '此处卡牌技能失效。', 'Card abilities are disabled here.', 'silence', {}, ['封锁', '技能'], '以基础战力而非技能取胜。'),
  front('echo-chamber', '回响军府', 'Echo Commandery', '部署技能在此额外触发一次。', 'Deploy abilities trigger one additional time here.', 'repeat_reveal', { times: 1 }, ['技能', '高风险'], '强力部署技能可获得爆发，但对手亦然。'),
  front('mist-bastion', '雾锁堡垒', 'Mist Bastion', '在此部署的卡牌延迟到下一回合揭示。', 'Cards played here reveal next turn.', 'delayed_reveal', {}, ['伏兵', '隐藏'], '隐藏战力能干扰对手判断。'),
  front('watchtower-zero', '先觉望楼', 'Forewatch Tower', '第三战线在第二回合提前揭示。', 'The third front is revealed one turn early.', 'early_reveal', {}, ['揭示', '情报'], '更早获取完整战场信息。'),
  front('cipher-field', '密算原', 'Cipher Field', '终局前不向对手显示此处总战力。', 'Power here is hidden from opponents until the finale.', 'hidden_power', {}, ['隐藏', '风险'], '需要通过卡牌数量与事件推测优势。'),
  front('upended-dais', '倒悬武台', 'Upended Dais', '终局时此处基础战力正负翻转。', 'At the finale, base power here is inverted.', 'invert_power', {}, ['终局', '高风险'], '低战力与负战力角色在终局反超。'),
  front('debtor-camp', '负功营', 'Debtor Camp', '当前战力为负的卡牌额外+6。', 'Cards with negative power gain +6.', 'negative_bonus', { amount: 6 }, ['战力', '反转'], '减益可以被转化为机会。'),
  front('plain-banner', '素旌台', 'Plain Banner', '无技能或已沉默的卡牌战力+4。', 'Cards with no active ability have +4 power.', 'vanilla_bonus', { amount: 4 }, ['技能', '战力'], '沉默与高基础值在此更有效。'),
  front('lone-watch', '孤烽哨', 'Lone Watch', '每方只有一张牌时，该牌战力+5。', 'A lone card on either side has +5 power.', 'solo_bonus', { amount: 5 }, ['孤军', '位置'], '单卡投注与后续增援之间需要取舍。'),
  front('packed-rampart', '连营壁', 'Packed Rampart', '占满容量的一方总战力+6。', 'A side at full capacity gains +6 total power.', 'full_bonus', { amount: 6 }, ['满场', '容量'], '规划费用曲线以完成满场。'),
  front('confluence-table', '万代会盟桌', 'Confluence Table', '每方每有一个不同时代，总战力+1。', 'Each distinct era on a side grants +1 total power.', 'cross_era_bonus', { amount: 1 }, ['时代', '连携'], '跨时代构筑在此拥有更高上限。')
];

export const FRONT_EFFECT_IDS = new Set(FRONT_DEFINITIONS.map((item) => item.effectId));

export function validateFrontDefinitions(fronts: readonly FrontDefinition[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of fronts) {
    if (ids.has(item.frontId)) errors.push(`Duplicate frontId: ${item.frontId}`);
    ids.add(item.frontId);
    if (!item.nameZh || !item.descriptionZh) errors.push(`Missing text: ${item.frontId}`);
    if (!item.effectId) errors.push(`Missing effectId: ${item.frontId}`);
    if (item.weight <= 0) errors.push(`Invalid weight: ${item.frontId}`);
  }
  if (fronts.filter((item) => item.enabled).length < 24) {
    errors.push('At least 24 fronts must be enabled.');
  }
  return errors;
}
