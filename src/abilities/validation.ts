import type { AbilityTrigger, CardAbilitySpec, ValidationIssue } from '../types.js';
import { CONDITION_TYPES } from './conditions.js';
import { EFFECT_HANDLERS } from './effects.js';
import { TARGET_SELECTOR_TYPES } from './selectors.js';

export const TRIGGER_ORDER: AbilityTrigger[] = [
  'on_draw', 'on_created', 'before_play', 'on_play', 'on_reveal', 'after_reveal', 'on_deploy',
  'after_card_played_here', 'after_ally_played', 'after_enemy_played', 'turn_start', 'turn_end',
  'before_move', 'after_move', 'on_discard', 'on_destroy', 'after_ally_destroyed', 'after_enemy_destroyed',
  'on_return_to_hand', 'on_front_revealed', 'on_front_won', 'on_front_lost', 'finale', 'before_scoring', 'ongoing'
];

const triggers = new Set<AbilityTrigger>([...TRIGGER_ORDER, 'deploy']);
const conditions = new Set(CONDITION_TYPES);
const selectors = new Set(TARGET_SELECTOR_TYPES);

export function validateAbilitySpec(ability: CardAbilitySpec, path = 'ability'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ability.abilityId) issues.push({ code: 'ABILITY_ID_REQUIRED', message: 'abilityId is required.', path });
  if (!triggers.has(ability.trigger)) issues.push({ code: 'INVALID_TRIGGER', message: `Unknown trigger: ${ability.trigger}`, path: `${path}.trigger` });
  if (!ability.nameZh || !ability.textZh) issues.push({ code: 'ABILITY_TEXT_REQUIRED', message: 'Ability name and text are required.', path });
  if (!ability.target || !selectors.has(ability.target.type)) issues.push({ code: 'INVALID_SELECTOR', message: `Unknown selector: ${ability.target?.type}`, path: `${path}.target` });
  for (const [index, condition] of (ability.conditions ?? []).entries()) {
    if (!conditions.has(condition.type)) issues.push({ code: 'INVALID_CONDITION', message: `Unknown condition: ${condition.type}`, path: `${path}.conditions[${index}]` });
  }
  if (!Array.isArray(ability.effects) || ability.effects.length === 0) issues.push({ code: 'ABILITY_EFFECT_REQUIRED', message: 'At least one effect is required.', path: `${path}.effects` });
  for (const [index, effect] of (ability.effects ?? []).entries()) {
    if (!EFFECT_HANDLERS.has(effect.type)) issues.push({ code: 'INVALID_EFFECT', message: `Unknown effect: ${effect.type}`, path: `${path}.effects[${index}]` });
    if (effect.target && !selectors.has(effect.target.type)) issues.push({ code: 'INVALID_EFFECT_SELECTOR', message: `Unknown effect selector: ${effect.target.type}`, path: `${path}.effects[${index}].target` });
  }
  if (ability.trigger === 'ongoing' && (ability.target.random || ability.effects.some((effect) => effect.target?.random))) {
    issues.push({ code: 'RANDOM_ONGOING_EFFECT', message: 'Ongoing effects cannot use random targets.', path });
  }
  return issues;
}
