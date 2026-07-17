# Aeonfront Protocol Version 3

`aeonfront/3` introduces explicit lobby, room, matchmaking and concurrent-game scopes. Version 2 clients and servers must reject the connection with `PROTOCOL_MISMATCH`; version 2 assumes one global room and cannot safely route version 3 messages.

## Envelope

Every client message includes `protocolVersion` and a unique `requestId`. Every server message includes `protocolVersion`, a monotonic transport `sequence`, and the originating `requestId` when applicable. Room and game messages also carry `roomId` or `gameId` at the envelope level.

The runtime validator checks the action-specific shape, identifier bounds, string lengths, room settings, deck arrays and turn values before dispatch. Servers additionally enforce payload byte limits, per-connection rates and request-id replay protection.

## Connection And Lobby

`join` establishes or reconnects a player session. It does not select a deck or start a game. The client then sends `enterLobby` and receives `lobbyEntered` followed by a `lobbySnapshot` containing:

- public server health and version information;
- the player's public presence record;
- bounded online presence, room and lobby-chat lists;
- the player's current matchmaking state.

Presence exposes only nickname, state, join time and a coarse latency bucket. It never exposes addresses, credentials or reconnect tokens.

## Rooms And Matchmaking

Room messages are `createRoom`, `joinRoom`, `leaveRoom`, `updateRoom`, `kickPlayer`, `selectDeck`, `setReady` and `sendRoomChat`. Room snapshots expose deck name and validity but not card IDs unless a completed match is being reviewed.

Quick matching uses `joinMatchmaking`, `leaveMatchmaking`, `matchFound`, `acceptMatch` and `declineMatch`. A matched pair receives an isolated room with an acceptance deadline. Declines, timeouts and disconnects release both tickets without affecting other rooms.

## Game Scope

Game actions retain the deterministic turn intent and now accept a `gameId` scope. Private state, event batches and completion payloads carry the same game scope. Each game has its own seed, state, event sequence, deadline and reconnect boundary.

Unrevealed fronts use a synthetic `front-slot-N` definition with the generic `hidden` artwork key. The actual front ID, name, effect and artwork key are absent from the player view until reveal. Concealed enemy cards similarly expose only their public instance identity.

## Battle Summary

At completion, participants receive a `gameEnded` payload with a deterministic `BattleSummary` and an optional serialized replay. The summary derives deployments, military orders, unused orders, final power, power deltas, moves, deaths, returns, discards, generated cards, ability triggers, banner and withdrawal timing, and control changes from the authoritative event sequence.

The summary also contains final front and card snapshots, a documented main-general score, deterministic highlights, three to five turning points and a turn-indexed timeline. No connection credentials, room passwords or reconnect tokens are serialized into match history.

## Deck Submission

The server resolves all card fields from its authoritative catalog. `SubmittedDeck` is validated for schema version, twelve unique known IDs, catalog version and enabled pack versions. Client-provided cost, power, text or ability data is never accepted.

## Compatibility

Legacy `ready` and `chatMessage` actions remain accepted as migration aliases inside a joined room. New clients use `setReady`, `sendLobbyChat` and `sendRoomChat`. Compatibility aliases do not restore global-room behavior.
