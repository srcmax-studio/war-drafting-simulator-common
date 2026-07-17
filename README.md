# Aeonfront Common

Shared deterministic rules, validation and protocol types for **万世战线 Aeonfront**.

The package has no browser, database, system-clock or network dependency. Given the same card catalog, front catalog, seed and player actions, it produces the same state and event log. The authoritative server executes these rules; clients consume only player-safe views.

## Included systems

- twelve-card deck validation, seeded shuffle and initial draw;
- six turns of increasing military orders and simultaneous plans;
- three unique fronts revealed over the opening turns;
- deterministic initiative and reveal ordering;
- structured ability registry with trigger depth and event limits;
- thirty original front definitions and effect handlers;
- banner stake changes, withdrawal and final scoring;
- hidden-information player/public views;
- serialization, action-event replay and replay verification;
- versioned client actions and server events.

## Commands

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run validate:fronts
npm run test:replay
```

Node.js 20 or newer is required. Consumers can import the public API from `src/index.ts` in a submodule checkout or from the built package entrypoint.

## Extending rules

Add abilities to `src/abilities.ts` and fronts to `src/fronts.ts`. Every effect must use structured arguments, deterministic selection and emitted events. Natural-language card text is presentation data, never executable input.
