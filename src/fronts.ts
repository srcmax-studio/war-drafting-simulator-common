import { PROTOCOL_VERSION, type FrontComplexity, type FrontDefinition } from './types.js';

interface FrontMetadata {
  weight?: number;
  complexity?: FrontComplexity;
  categories?: string[];
  incompatibleWith?: string[];
  incompatibleTags?: string[];
}

const front = (
  frontId: string,
  nameZh: string,
  nameEn: string,
  descriptionZh: string,
  descriptionEn: string,
  effectId: string,
  effectArgs: Record<string, unknown>,
  tags: string[],
  strategyZh: string,
  metadata: FrontMetadata = {}
): FrontDefinition => ({
  frontId,
  nameZh,
  nameEn,
  descriptionZh,
  descriptionEn,
  effectId,
  effectArgs,
  enabled: true,
  weight: metadata.weight ?? 1,
  complexity: metadata.complexity ?? 'simple',
  categories: metadata.categories ?? tags,
  ...(metadata.incompatibleWith ? { incompatibleWith: metadata.incompatibleWith } : {}),
  ...(metadata.incompatibleTags ? { incompatibleTags: metadata.incompatibleTags } : {}),
  minimumClientVersion: PROTOCOL_VERSION,
  packId: 'core',
  tags,
  strategyZh
});

export const FRONT_DEFINITIONS: FrontDefinition[] = [
  front('bronze-road', '青铜驿道', 'Bronze Relay', '在此部署的卡牌费用降低1，最低为1。', 'Cards deployed here cost 1 less, to a minimum of 1.', 'cost_down', { amount: 1 }, ['军令', '节奏'], '适合提前展开高费角色。', { categories: ['economy'] }),
  front('taxed-crossing', '榷税渡口', 'Levy Crossing', '在此部署的卡牌费用提高1。', 'Cards deployed here cost 1 more.', 'cost_up', { amount: 1 }, ['军令', '风险'], '保留军令，避免在同一回合拥堵。', { categories: ['economy', 'high-risk'] }),
  front('signal-ridge', '烽讯高地', 'Signal Ridge', '此处卡牌最终战力+2。', 'Cards here have +2 final power.', 'base_power_up', { amount: 2 }, ['战力'], '低费铺场可放大固定增益。'),
  front('salt-marsh', '白盐泽', 'White Salt Marsh', '此处卡牌最终战力-2。', 'Cards here have -2 final power.', 'base_power_down', { amount: 2 }, ['战力', '风险'], '优先投入能承受减益的高战力角色。', { categories: ['power', 'high-risk'] }),
  front('age-archive', '纪元档案馆', 'Archive of Ages', '神话时代角色战力+3。', 'Mythic-era cards have +3 power.', 'era_bonus', { era: '神话时代', amount: 3 }, ['时代', '连携'], '围绕指定时代构筑可获得稳定优势。', { categories: ['trait'] }),
  front('eastern-meridian', '东陆经纬台', 'Eastern Meridian', '东亚角色战力+3。', 'East Asian cards have +3 power.', 'region_bonus', { region: '东亚', amount: 3 }, ['地区', '连携'], '地区密度越高，收益越可靠。', { categories: ['trait'] }),
  front('artificer-yard', '百工营造司', 'Artificer Yard', '建设类职业角色战力+3。', 'Builder cards have +3 power.', 'profession_bonus', { professionIncludes: '建', amount: 3 }, ['职业', '连携'], '建设者可在此形成坚固阵地。', { categories: ['trait'] }),
  front('crown-court', '列王议庭', 'Court of Crowns', '君主与皇帝身份角色战力+3。', 'Rulers have +3 power.', 'identity_bonus', { identities: ['君主', '皇帝', '国王', '法老'], amount: 3 }, ['身份', '统御'], '统治者牌组应争夺此处。', { categories: ['trait'] }),
  front('westward-current', '西迁风道', 'Westward Current', '回合结束时，各方最右侧一张牌向左调遣。', 'At turn end, each side moves its rightmost card one front left.', 'move_left', {}, ['调遣', '位置', 'forced-move'], '预判移动后的位置再部署。', { complexity: 'advanced', categories: ['movement', 'dynamic'] }),
  front('broken-compass', '失准罗盘场', 'Broken Compass', '回合结束时，各方随机一张牌调遣到相邻战线。', 'At turn end, one random card per side moves to an adjacent front.', 'random_move', {}, ['调遣', '风险', 'forced-move'], '分散战力可降低随机调遣的损失。', { complexity: 'chaotic', categories: ['movement', 'dynamic', 'high-risk'], weight: 0.7 }),
  front('muster-gate', '万民征集门', 'Muster Gate', '回合结束时，在此有牌的玩家抽一张牌。', 'At turn end, players with a card here draw one card.', 'recruit', { count: 1 }, ['征召', '手牌'], '尽早占领可持续补充手牌。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('mirror-foundry', '镜铸工坊', 'Mirror Foundry', '首次在此部署时，生成一张该牌的基础复制到手牌。', 'The first card played here creates a base copy in hand.', 'copy', {}, ['复制', '资源'], '优先复制高价值或低费角色。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('sealed-dispatch', '封缄驿站', 'Sealed Dispatch', '回合结束时，手牌最多的玩家弃置一张牌。', 'At turn end, the player with the most cards discards one.', 'discard', { count: 1 }, ['弃置', '手牌'], '控制手牌数量，避免成为唯一目标。', { complexity: 'advanced', categories: ['economy', 'death', 'dynamic'] }),
  front('execution-ground', '断旌刑场', 'Bannerfall Ground', '回合结束时，此处战力最低的已揭示卡牌阵亡。', 'At turn end, the lowest-power revealed card here is destroyed.', 'destroy', {}, ['阵亡', '风险'], '不要留下孤立的低战力目标。', { complexity: 'advanced', categories: ['death', 'dynamic', 'high-risk'] }),
  front('returning-shore', '归帆古岸', 'Returning Shore', '回合结束时，各方复归一张最早阵亡的卡牌到手牌。', 'At turn end, each side returns its oldest fallen card to hand.', 'return', {}, ['复归', '资源'], '主动阵亡可转化为后续手牌。', { complexity: 'advanced', categories: ['death', 'dynamic'] }),
  front('wide-formation', '开阔阵原', 'Open Formation', '每名玩家在此容量+1。', 'Each player has +1 capacity here.', 'capacity_up', { amount: 1 }, ['容量', '铺场'], '适合多卡连携与满场奖励。', { categories: ['capacity'] }),
  front('narrow-pass', '一线天关', 'Needle Pass', '每名玩家在此容量-1。', 'Each player has 1 less capacity here.', 'capacity_down', { amount: 1 }, ['容量', '封锁'], '高质量单卡比铺场更重要。', { categories: ['capacity'], incompatibleTags: ['capacity-down'] }),
  front('light-foot-ward', '轻骑戒域', 'Lightfoot Ward', '费用4及以上的卡牌不能部署于此。', 'Cards costing 4 or more cannot be deployed here.', 'ban_high_cost', { threshold: 4 }, ['部署限制'], '用低费曲线争夺战线。', { categories: ['capacity', 'economy'] }),
  front('heavy-standard', '重旌禁区', 'Heavy Standard', '费用2及以下的卡牌不能部署于此。', 'Cards costing 2 or less cannot be deployed here.', 'ban_low_cost', { threshold: 2 }, ['部署限制'], '预留中高费角色。', { categories: ['capacity', 'economy'] }),
  front('silent-obelisk', '无铭碑林', 'Nameless Steles', '此处卡牌技能失效。', 'Card abilities are disabled here.', 'silence', {}, ['封锁', '技能'], '以基础战力而非技能取胜。', { complexity: 'advanced', categories: ['control'] }),
  front('echo-chamber', '回响军府', 'Echo Commandery', '部署技能在此额外触发一次。', 'Deploy abilities trigger one additional time here.', 'repeat_reveal', { times: 1 }, ['技能', '高风险'], '强力部署技能可获得爆发，但对手亦然。', { complexity: 'chaotic', categories: ['dynamic', 'high-risk'], weight: 0.7, incompatibleTags: ['repeat'] }),
  front('mist-bastion', '雾锁堡垒', 'Mist Bastion', '在此部署的卡牌延迟到下一回合揭示。', 'Cards played here reveal next turn.', 'delayed_reveal', {}, ['伏兵', '隐藏'], '隐藏战力能干扰对手判断。', { complexity: 'advanced', categories: ['hidden', 'dynamic'] }),
  front('watchtower-zero', '先觉望楼', 'Forewatch Tower', '第三战线在第二回合提前揭示。', 'The third front is revealed one turn early.', 'early_reveal', {}, ['揭示', '情报'], '更早获取完整战场信息。', { categories: ['hidden'], incompatibleTags: ['reveal-order'] }),
  front('cipher-field', '密算原', 'Cipher Field', '终局前不向对手显示此处总战力。', 'Power here is hidden from opponents until the finale.', 'hidden_power', {}, ['隐藏', '风险'], '需要通过卡牌数量与事件推测优势。', { complexity: 'advanced', categories: ['hidden', 'high-risk'] }),
  front('upended-dais', '倒悬武台', 'Upended Dais', '终局时此处基础战力正负翻转。', 'At the finale, base power here is inverted.', 'invert_power', {}, ['终局', '高风险'], '低战力与负战力角色在终局反超。', { complexity: 'chaotic', categories: ['dynamic', 'high-risk'], weight: 0.6 }),
  front('debtor-camp', '负功营', 'Debtor Camp', '当前战力为负的卡牌额外+6。', 'Cards with negative power gain +6.', 'negative_bonus', { amount: 6 }, ['战力', '反转'], '减益可以被转化为机会。', { complexity: 'advanced', categories: ['power', 'high-risk'] }),
  front('plain-banner', '素旌台', 'Plain Banner', '无技能或已沉默的卡牌战力+4。', 'Cards with no active ability have +4 power.', 'vanilla_bonus', { amount: 4 }, ['技能', '战力'], '沉默与高基础值在此更有效。'),
  front('lone-watch', '孤烽哨', 'Lone Watch', '每方只有一张牌时，该牌战力+5。', 'A lone card on either side has +5 power.', 'solo_bonus', { amount: 5 }, ['孤军', '位置'], '单卡投注与后续增援之间需要取舍。', { categories: ['capacity'] }),
  front('packed-rampart', '连营壁', 'Packed Rampart', '占满容量的一方总战力+6。', 'A side at full capacity gains +6 total power.', 'full_bonus', { amount: 6 }, ['满场', '容量'], '规划费用曲线以完成满场。', { categories: ['capacity'] }),
  front('confluence-table', '万代会盟桌', 'Confluence Table', '每方每有一个不同时代，总战力+1。', 'Each distinct era on a side grants +1 total power.', 'cross_era_bonus', { amount: 1 }, ['时代', '连携'], '跨时代构筑在此拥有更高上限。', { categories: ['trait'] }),

  front('ancient-concord', '上古盟誓坛', 'Ancient Concord', '神话、青铜与古典时代角色战力+2。', 'Mythic, Bronze, and Classical era cards have +2 power.', 'ancient_concord', { eras: ['神话时代', '青铜时代', '古典时代'], amount: 2 }, ['时代'], '古代角色可以稳定建立优势。', { categories: ['trait'] }),
  front('medieval-bastion', '中世壁垒', 'Medieval Bastion', '中世纪角色战力+3，其他角色战力-1。', 'Medieval cards have +3 power; others have -1.', 'medieval_bastion', { eraIncludes: '中世纪', amount: 3, penalty: 1 }, ['时代', '风险'], '集中中世纪角色可以抵消惩罚。', { complexity: 'advanced', categories: ['trait', 'high-risk'] }),
  front('modern-exchange', '近世交易所', 'Modern Exchange', '工业与现代时代角色部署后抽牌一次，每方每局限一次。', 'Industrial and Modern cards draw once after deployment per player.', 'modern_exchange', { eras: ['工业时代', '现代'], count: 1 }, ['时代', '手牌'], '以近现代角色换取节奏。', { complexity: 'advanced', categories: ['trait', 'economy', 'dynamic'] }),
  front('future-beacon', '未来信标', 'Future Beacon', '未来时代角色费用-1且战力+2。', 'Future-era cards cost 1 less and have +2 power.', 'future_beacon', { era: '未来时代', cost: 1, amount: 2 }, ['时代', '军令'], '未来角色可更早形成终局阵线。', { complexity: 'advanced', categories: ['trait', 'economy'] }),
  front('single-era-citadel', '同代城塞', 'Single-Era Citadel', '若此处友军均属同一时代，总战力+6。', 'A side whose cards share one era gains +6 total power.', 'same_era_focus', { amount: 6 }, ['时代', '集中'], '保持时代纯度可获得高额奖励。', { categories: ['trait'] }),
  front('seven-age-forum', '七纪论坛', 'Seven-Age Forum', '每个不同的时代使此处总战力+2。', 'Each distinct era here grants +2 total power.', 'era_diversity', { amount: 2 }, ['时代', '多样'], '多时代构筑在此上限更高。', { categories: ['trait'] }),
  front('homeland-redoubt', '乡土要塞', 'Homeland Redoubt', '若此处友军来自同一地区，总战力+5。', 'A side whose cards share one region gains +5 total power.', 'same_region_focus', { amount: 5 }, ['地区', '集中'], '地区主题牌组容易稳定触发。', { categories: ['trait'] }),
  front('world-congress', '寰宇议会', 'World Congress', '每个不同地区使此处总战力+2。', 'Each distinct region here grants +2 total power.', 'region_diversity', { amount: 2 }, ['地区', '多样'], '跨地区组合可拉高上限。', { categories: ['trait'] }),
  front('coalition-ground', '联军会场', 'Coalition Ground', '同阵营友军每有一名，彼此额外+1战力。', 'Cards sharing a faction reinforce each other by +1.', 'faction_muster', { amount: 1 }, ['阵营'], '阵营密度越高，增益越大。', { complexity: 'advanced', categories: ['trait'] }),
  front('guild-conclave', '百业会馆', 'Guild Conclave', '此处相同职业的第二张及后续角色各+3战力。', 'The second and later cards of a profession gain +3 power.', 'profession_conclave', { amount: 3 }, ['职业'], '围绕职业构筑可获得递进收益。', { complexity: 'advanced', categories: ['trait'] }),
  front('oath-chain', '连誓长廊', 'Oath Chain', '每张与相邻友军共享标签的角色战力+2。', 'Cards sharing a tag with an adjacent ally gain +2 power.', 'tag_chain', { amount: 2 }, ['标签', '位置'], '展示顺序与标签都影响收益。', { complexity: 'advanced', categories: ['trait', 'movement'] }),
  front('many-crowns', '众身份议庭', 'Many Crowns', '每个不同身份使此处总战力+1。', 'Each distinct identity here grants +1 total power.', 'identity_council', { amount: 1 }, ['身份'], '多样身份带来稳定的广度收益。', { categories: ['trait'] }),

  front('eastward-current', '东归风道', 'Eastward Current', '回合结束时，各方最左侧一张牌向右调遣。', 'At turn end, each side moves its leftmost card one front right.', 'move_right', {}, ['调遣', 'forced-move'], '提前为向右移动保留容量。', { complexity: 'advanced', categories: ['movement', 'dynamic'] }),
  front('central-muster', '中军聚合场', 'Central Muster', '回合结束时，两侧各一名友军尽可能向中央集结。', 'At turn end, one card from each flank moves toward the center.', 'center_reinforce', {}, ['调遣', 'forced-move'], '中央战线会逐渐成为主战场。', { complexity: 'advanced', categories: ['movement', 'dynamic'] }),
  front('flank-sortie', '两翼出击台', 'Flank Sortie', '回合结束时，中央最后部署的角色向较弱侧翼调遣。', 'At turn end, the newest center card moves to the weaker flank.', 'flank_reinforce', {}, ['调遣', 'forced-move'], '利用中央部署为薄弱侧补强。', { complexity: 'advanced', categories: ['movement', 'dynamic'] }),
  front('wheel-formation', '轮转军阵', 'Wheel Formation', '每个偶数回合结束时，各方角色位置整体向右轮换。', 'At each even turn end, each side rotates its cards right.', 'rotate_positions', { every: 2 }, ['调遣', 'forced-move'], '按轮换后的落点规划两回合节奏。', { complexity: 'chaotic', categories: ['movement', 'dynamic'], weight: 0.7 }),
  front('adjacent-exchange', '邻阵易位桥', 'Adjacent Exchange', '回合结束时，此处双方最强角色与相邻战线最弱角色交换位置。', 'At turn end, each side swaps its strongest card here with its weakest adjacent card.', 'swap_adjacent', {}, ['调遣', 'forced-move'], '强牌可能被送离关键战线。', { complexity: 'chaotic', categories: ['movement', 'dynamic', 'high-risk'], weight: 0.7 }),
  front('immovable-fort', '不动坚城', 'Immovable Fort', '此处角色不能被调遣。', 'Cards here cannot be moved.', 'no_move', {}, ['禁止移动', 'no-move'], '将核心角色安置于此可避免位移。', { categories: ['movement', 'control'], incompatibleTags: ['forced-move'] }),
  front('growing-camp', '扩建营盘', 'Growing Camp', '第三回合起，此处容量+1；第五回合再+1。', 'This front gains capacity on turns three and five.', 'capacity_by_turn', { turns: [3, 5], amount: 1 }, ['容量'], '后期可在此展开更宽阵型。', { complexity: 'advanced', categories: ['capacity', 'dynamic'] }),
  front('single-file-gate', '单列军门', 'Single-File Gate', '每名玩家每回合最多向此部署一张卡。', 'Each player may deploy at most one card here each turn.', 'single_deploy', { count: 1 }, ['部署限制'], '逐回合经营比单回合爆发更可靠。', { categories: ['capacity'] }),
  front('first-standard', '先登旌台', 'First Standard', '每回合最先在此部署的角色永久+2战力。', 'The first card deployed here each turn permanently gains +2 power.', 'first_play_bonus', { amount: 2 }, ['部署', '先手'], '争取每回合的首次部署奖励。', { complexity: 'advanced', categories: ['capacity', 'dynamic'] }),
  front('last-bastion', '末席堡垒', 'Last Bastion', '填满此处最后一个位置的角色永久+4战力。', 'The card filling the last slot here permanently gains +4 power.', 'last_slot_bonus', { amount: 4 }, ['容量', '满场'], '控制填满时机可放大奖励。', { complexity: 'advanced', categories: ['capacity', 'dynamic'] }),

  front('quartermaster-dock', '辎重码头', 'Quartermaster Dock', '第三与第五回合结束时，在此有牌的玩家抽一张牌。', 'Players present here draw at the end of turns three and five.', 'turn_draw', { turns: [3, 5], count: 1 }, ['手牌', '军令'], '阶段性补给适合中速牌组。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('mobile-foundry', '随军铸坊', 'Mobile Foundry', '手牌中费用4及以上的角色向此部署时费用-1。', 'Cards costing 4 or more cost 1 less when played here.', 'hand_cost_down', { threshold: 4, amount: 1 }, ['费用', '高费'], '更容易部署核心和终结角色。', { categories: ['economy'] }),
  front('conscription-tax', '轻兵附税所', 'Conscription Tax', '费用1至2的角色向此部署时额外消耗1军令。', 'Cards costing 1 or 2 cost 1 more when played here.', 'low_cost_surcharge', { threshold: 2, amount: 1 }, ['费用', '低费'], '高费单卡更适合争夺此处。', { categories: ['economy'] }),
  front('reserve-converter', '余令转势台', 'Reserve Converter', '回合结束时，此处每点未使用军令转化为+1总战力，持续到终局。', 'At turn end, each unspent order becomes +1 final power here.', 'unused_energy_power', { amount: 1 }, ['军令', '战力'], '少部署可以换取长期战力。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('veteran-pass', '重将关券', 'Veteran Pass', '每回合首张费用5至6的角色向此部署时费用-2。', 'The first 5- or 6-cost card here each turn costs 2 less.', 'high_cost_discount', { threshold: 5, amount: 2 }, ['费用', '高费'], '为终结角色预留关键窗口。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('opening-requisition', '先遣征调处', 'Opening Requisition', '每回合向此部署的第一张卡费用-1。', 'The first card played here each turn costs 1 less.', 'first_card_discount', { amount: 1 }, ['费用', '首张'], '用关键牌领取回合优惠。', { complexity: 'advanced', categories: ['economy', 'dynamic'] }),
  front('final-requisition', '终局征调处', 'Final Requisition', '第六回合向此部署的卡牌费用-2。', 'Cards played here on turn six cost 2 less.', 'final_turn_discount', { turn: 6, amount: 2 }, ['费用', '终局'], '保留高费牌在最终回合爆发。', { categories: ['economy', 'dynamic'] }),
  front('ash-ledger', '灰烬账簿院', 'Ash Ledger', '每方每弃置一张牌，此处总战力永久+2。', 'Each discarded card grants its owner +2 final power here.', 'discard_reward', { amount: 2 }, ['弃置', '战力'], '弃置体系可将资源损失转成战场优势。', { complexity: 'advanced', categories: ['economy', 'death', 'dynamic'] }),
  front('archive-recycler', '旧卷回收库', 'Archive Recycler', '回合结束时，各方将一张弃牌洗回牌库并抽一张牌。', 'At turn end, each side shuffles one discarded card into its deck, then draws.', 'shuffle_discard', { count: 1 }, ['弃置', '牌库'], '循环关键牌但会改变后续抽牌。', { complexity: 'advanced', categories: ['economy', 'death', 'dynamic'] }),

  front('reverse-theatre', '逆序演武场', 'Reverse Theatre', '此处角色按部署顺序逆序揭示。', 'Cards here reveal in reverse deployment order.', 'reverse_reveal', {}, ['揭示', '顺序', 'reveal-order'], '后部署的角色会先结算。', { complexity: 'advanced', categories: ['hidden', 'dynamic'], incompatibleTags: ['reveal-order'] }),
  front('ambush-valley', '伏兵幽谷', 'Ambush Valley', '未揭示角色战力+3，揭示后失去该增益。', 'Unrevealed cards have +3 power until revealed.', 'unrevealed_bonus', { amount: 3 }, ['隐藏', '伏兵'], '延迟揭示可形成暂时优势。', { categories: ['hidden'] }),
  front('late-intelligence', '迟报军府', 'Late Intelligence', '此战线直到第四回合才揭示。', 'This front is not revealed until turn four.', 'late_front_reveal', { turn: 4 }, ['隐藏', '情报', 'reveal-order'], '前期需在未知规则下投入。', { complexity: 'advanced', categories: ['hidden', 'high-risk'], incompatibleTags: ['reveal-order'] }),
  front('masked-strength', '匿势营', 'Masked Strength', '终局前，对手看不到此处卡牌身份和总战力。', 'Opponents cannot see card identities or total power here before the finale.', 'concealed_lane', {}, ['隐藏', '战力'], '通过事件与卡牌数量推测对手投入。', { complexity: 'advanced', categories: ['hidden', 'high-risk'] }),
  front('dawn-signal', '破晓号台', 'Dawn Signal', '第二回合开始时，所有战线与伏兵立即揭示。', 'At turn two, all fronts and hidden cards reveal immediately.', 'reveal_all_early', { turn: 2 }, ['揭示', '情报', 'reveal-order'], '提前获得完整信息并触发揭示能力。', { complexity: 'advanced', categories: ['hidden', 'dynamic'], incompatibleTags: ['reveal-order'] }),

  front('phoenix-gate', '凤还关', 'Phoenix Gate', '每方在此首次阵亡的角色于回合结束时复归此处并获得+2战力。', 'Each side revives its first fallen card here with +2 power.', 'first_death_revive', { amount: 2 }, ['阵亡', '复归'], '首个牺牲可转化为更强返场。', { complexity: 'advanced', categories: ['death', 'dynamic'] }),
  front('ancestor-field', '先祖原', 'Ancestor Field', '阵亡区每有一名角色，此处总战力+1，最多+6。', 'Each fallen card grants +1 total power here, up to +6.', 'graveyard_power', { amount: 1, maximum: 6 }, ['阵亡', '战力'], '主动阵亡能持续强化此处。', { categories: ['death'] }),
  front('martyr-memorial', '殉志碑', 'Martyr Memorial', '友军在其他战线阵亡时，此处最弱友军永久+2战力。', 'When an ally dies elsewhere, the weakest ally here permanently gains +2.', 'death_boon', { amount: 2 }, ['阵亡', '增益'], '分线牺牲可以培养此处核心。', { complexity: 'advanced', categories: ['death', 'dynamic'] }),
  front('closing-chasm', '闭合裂谷', 'Closing Chasm', '第五回合结束时，此处所有角色阵亡；第六回合重新开放。', 'All cards here die after turn five; the front reopens for turn six.', 'front_closes', { turn: 5 }, ['阵亡', '高风险'], '前五回合投入会被清空，但能服务阵亡体系。', { complexity: 'chaotic', categories: ['death', 'dynamic', 'high-risk'], weight: 0.6 }),

  front('balancing-tide', '均势潮汐', 'Balancing Tide', '回合结束时，领先方最强角色-2战力，落后方最弱角色+2战力。', 'At turn end, the leader loses 2 power and the trailer gains 2.', 'leader_pressure', { amount: 2 }, ['追赶', '风险'], '领先幅度会被持续压缩。', { complexity: 'chaotic', categories: ['dynamic', 'high-risk'], weight: 0.7 }),
  front('migrating-crown', '迁徙王冠', 'Migrating Crown', '终局时，此处领先方将一半超额战力支援其最弱战线。', 'At the finale, half the leading margin supports the leader\'s weakest front.', 'shared_margin', { ratio: 0.5 }, ['终局', '跨线'], '在此建立优势可影响另一条战线。', { complexity: 'chaotic', categories: ['movement', 'dynamic', 'high-risk'], weight: 0.6 })
];

export const FRONT_EFFECT_IDS = new Set(FRONT_DEFINITIONS.map((item) => item.effectId));

export function areFrontsCompatible(selected: readonly FrontDefinition[], candidate: FrontDefinition): boolean {
  return selected.every((front) => {
    if (front.incompatibleWith?.includes(candidate.frontId) || candidate.incompatibleWith?.includes(front.frontId)) return false;
    if (front.incompatibleTags?.some((tag) => candidate.tags.includes(tag))) return false;
    if (candidate.incompatibleTags?.some((tag) => front.tags.includes(tag))) return false;
    if (front.complexity === 'chaotic' && candidate.complexity === 'chaotic') return false;
    return true;
  });
}

export function validateFrontDefinitions(fronts: readonly FrontDefinition[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of fronts) {
    if (ids.has(item.frontId)) errors.push(`Duplicate frontId: ${item.frontId}`);
    ids.add(item.frontId);
    if (!item.nameZh || !item.nameEn || !item.descriptionZh || !item.descriptionEn) errors.push(`Missing text: ${item.frontId}`);
    if (!item.effectId) errors.push(`Missing effectId: ${item.frontId}`);
    if (!Number.isFinite(item.weight) || item.weight <= 0) errors.push(`Invalid weight: ${item.frontId}`);
    if (!['simple', 'advanced', 'chaotic'].includes(item.complexity)) errors.push(`Invalid complexity: ${item.frontId}`);
    if (!item.packId || item.categories.length === 0) errors.push(`Missing pool metadata: ${item.frontId}`);
    for (const incompatibleId of item.incompatibleWith ?? []) if (!fronts.some((front) => front.frontId === incompatibleId)) errors.push(`Unknown incompatible front ${incompatibleId}: ${item.frontId}`);
  }
  if (fronts.filter((item) => item.enabled).length < 72) errors.push('At least 72 fronts must be enabled.');
  return errors;
}
