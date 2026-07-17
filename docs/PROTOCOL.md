# Aeonfront Protocol Version 2

`aeonfront/2` is the required protocol for the multi-ability catalog and versioned custom decks. Version 1 clients and servers must reject the connection with `PROTOCOL_MISMATCH`; they cannot safely interpret version 2 card or front state.

## Deck Submission

`selectDeck` and `practice` retain `cardIds` for transport compatibility and add:

```ts
interface SubmittedDeck {
  schemaVersion: number;
  deckId: string;
  name: string;
  cardIds: string[];
  catalogVersion: string;
  packVersions?: Record<string, string>;
}
```

The server resolves all card fields from its authoritative catalog. It validates exactly twelve unique known IDs, the catalog version, enabled pack versions and schema version. Client-provided cost, power, text or ability data is never accepted.

## Game State

Player views may include `catalogVersion`. Serialized games preserve catalog and pack versions in `setup`, together with submitted deck IDs and names when available. Reconnect, rematch, history and replay therefore use the original authoritative deck list.

Card instances may include current cost, markers, statuses, usage counters, movement state and creation origin. Unrevealed or concealed opponent instances expose only the public instance identifier, owner and reveal flag.

## Deterministic Resolution

Abilities resolve by explicit trigger phase, descending priority, stable ability ID, deployment order and instance ID. Random selectors consume the game RNG state. Every ability and front effect emits structured start, effect and completion events. Trigger depth, repeated triggers and per-resolution event counts are bounded.

## Compatibility

Legacy card records containing `abilityId`, `abilityArgs`, `trigger` and `targetRule` are adapted at load time. Newly generated records use `abilities` and retain a projection of the first ability only for migration. Version 2 writers must not emit new single-ability-only records.
