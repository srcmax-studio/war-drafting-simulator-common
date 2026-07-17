import { ABILITY_REGISTRY } from './abilities.js';
import { DECK_SIZE, type CardDefinition, type ValidationIssue, type ValidationResult } from './types.js';

export function validateCardDefinitions(cards: readonly CardDefinition[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cardIds = new Set<string>();
  const slugs = new Set<string>();
  for (const [index, card] of cards.entries()) {
    const path = `cards[${index}]`;
    if (!card.cardId) issues.push({ code: 'CARD_ID_REQUIRED', message: 'cardId is required.', path });
    if (cardIds.has(card.cardId)) issues.push({ code: 'DUPLICATE_CARD_ID', message: `Duplicate cardId: ${card.cardId}`, path });
    cardIds.add(card.cardId);
    if (!card.slug || slugs.has(card.slug)) issues.push({ code: 'DUPLICATE_OR_EMPTY_SLUG', message: `Invalid slug: ${card.slug}`, path });
    slugs.add(card.slug);
    if (!Number.isInteger(card.cost) || card.cost < 1 || card.cost > 6) issues.push({ code: 'INVALID_COST', message: `Invalid cost: ${card.cost}`, path });
    if (!Number.isInteger(card.power) || card.power < -10 || card.power > 20) issues.push({ code: 'INVALID_POWER', message: `Invalid power: ${card.power}`, path });
    if (!ABILITY_REGISTRY.has(card.abilityId)) issues.push({ code: 'UNKNOWN_ABILITY', message: `Unknown ability: ${card.abilityId}`, path });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function validateDeck(deck: readonly string[], catalog: Readonly<Record<string, CardDefinition>>): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (deck.length !== DECK_SIZE) {
    issues.push({ code: 'INVALID_DECK_SIZE', message: `A deck must contain exactly ${DECK_SIZE} cards.` });
  }
  if (new Set(deck).size !== deck.length) {
    issues.push({ code: 'DUPLICATE_CARD', message: 'A deck cannot contain duplicate cardId values.' });
  }
  deck.forEach((cardId, index) => {
    if (!catalog[cardId]) issues.push({ code: 'UNKNOWN_CARD', message: `Unknown cardId: ${cardId}`, path: `deck[${index}]` });
  });
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
