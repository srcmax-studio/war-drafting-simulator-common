import type {
  LobbyChatMessage,
  LobbySnapshot,
  MatchmakingState,
  PresenceEntry,
  RoomState,
  RoomSummary,
  ServerStatus,
  StructuredProtocolError
} from './lobby.js';
import { LOBBY_LIMITS } from './lobby.js';
import type { BattleSummary } from './summary.js';
import type { GameEvent, PlayerView, SubmittedDeck, TurnIntent } from './types.js';

interface ClientEnvelope {
  protocolVersion: string;
  requestId: string;
}

interface RoomCreationInput {
  name: string;
  visibility: 'public' | 'private';
  password?: string;
  allowSpectators: boolean;
  turnDurationMs: number;
  packIds: string[];
  tags: string[];
  revealDecks: boolean;
}

interface RoomUpdateInput {
  name?: string;
  visibility?: 'public' | 'private';
  password?: string;
  allowSpectators?: boolean;
  turnDurationMs?: number;
  tags?: string[];
  revealDecks?: boolean;
}

export type ClientAction = ClientEnvelope & (
  | { action: 'status' }
  | { action: 'authenticate'; password: string }
  | { action: 'join'; name: string; reconnectToken?: string }
  | { action: 'enterLobby' }
  | { action: 'leaveLobby' }
  | { action: 'requestLobbySnapshot' }
  | { action: 'requestRoomList'; query?: string; joinableOnly?: boolean; offset?: number; limit?: number }
  | { action: 'requestPresence' }
  | { action: 'createRoom'; room: RoomCreationInput }
  | { action: 'joinRoom'; roomId: string; password?: string }
  | { action: 'leaveRoom'; roomId: string }
  | { action: 'updateRoom'; roomId: string; patch: RoomUpdateInput }
  | { action: 'kickPlayer'; roomId: string; playerId: string }
  | { action: 'selectDeck'; roomId?: string; deckId?: string; cardIds: string[]; catalogVersion?: string; deck?: SubmittedDeck }
  | { action: 'setReady'; roomId: string; ready: boolean }
  | { action: 'ready'; roomId?: string }
  | { action: 'sendLobbyChat'; message: string }
  | { action: 'sendRoomChat'; roomId: string; message: string }
  | { action: 'chatMessage'; message: string }
  | { action: 'joinMatchmaking'; deck: SubmittedDeck; mmr?: number }
  | { action: 'leaveMatchmaking' }
  | { action: 'acceptMatch'; roomId: string }
  | { action: 'declineMatch'; roomId: string }
  | { action: 'submitTurn'; gameId?: string; intent: TurnIntent }
  | { action: 'undoTurn'; gameId?: string; turn: number }
  | { action: 'lockTurn'; gameId?: string; turn: number }
  | { action: 'raiseBanner'; gameId?: string; turn: number }
  | { action: 'withdraw'; gameId?: string; turn: number }
  | { action: 'requestSync'; roomId?: string; gameId?: string }
  | { action: 'requestRematch'; gameId?: string }
  | { action: 'returnToLobby'; gameId?: string }
  | { action: 'practice'; deckId?: string; cardIds: string[]; catalogVersion?: string; deck?: SubmittedDeck }
  | { action: 'pong'; clientTime?: number }
);

interface ServerEnvelope<TEvent extends string, TPayload> {
  event: TEvent;
  protocolVersion: string;
  sequence: number;
  requestId?: string;
  roomId?: string;
  gameId?: string;
  payload: TPayload;
}

export type ServerEvent =
  | ServerEnvelope<'serverStatus', ServerStatus>
  | ServerEnvelope<'authenticated', { ok: true }>
  | ServerEnvelope<'joined' | 'reconnected', { playerId: string; name: string; reconnectToken: string }>
  | ServerEnvelope<'lobbyEntered', { playerId: string }>
  | ServerEnvelope<'lobbySnapshot', LobbySnapshot>
  | ServerEnvelope<'presenceUpdated', PresenceEntry[]>
  | ServerEnvelope<'roomListSnapshot', RoomSummary[]>
  | ServerEnvelope<'roomCreated' | 'roomUpdated' | 'roomJoined', RoomState>
  | ServerEnvelope<'roomRemoved' | 'roomLeft', { roomId: string }>
  | ServerEnvelope<'roomState', RoomState>
  | ServerEnvelope<'roomError', StructuredProtocolError>
  | ServerEnvelope<'lobbyChatMessage' | 'roomChatMessage', LobbyChatMessage>
  | ServerEnvelope<'matchmakingQueued' | 'matchmakingUpdated', MatchmakingState>
  | ServerEnvelope<'matchFound', MatchmakingState & { room: RoomState }>
  | ServerEnvelope<'matchCancelled', { reason: string }>
  | ServerEnvelope<'gameStarting', { gameId: string; startsAt: number }>
  | ServerEnvelope<'gameStarted' | 'practiceStarted', { gameId: string; mode: 'online' | 'practice' }>
  | ServerEnvelope<'privateGameState' | 'publicGameState', PlayerView & { deadline?: number | null }>
  | ServerEnvelope<'gameEventBatch', GameEvent[]>
  | ServerEnvelope<'turnAccepted' | 'turnRejected' | 'turnLocked' | 'turnResolved', Record<string, unknown>>
  | ServerEnvelope<'bannerRaised' | 'stakeChanged' | 'playerWithdrew', Record<string, unknown>>
  | ServerEnvelope<'gameEnded', { summary: BattleSummary; serializedGame?: string }>
  | ServerEnvelope<'returnedToLobby', { playerId: string }>
  | ServerEnvelope<'deckSelected' | 'readyAccepted' | 'rematchRequested' | 'requestAccepted' | 'pong', Record<string, unknown>>
  | ServerEnvelope<'error', StructuredProtocolError>;

const KNOWN_ACTIONS = new Set([
  'status', 'authenticate', 'join', 'enterLobby', 'leaveLobby', 'requestLobbySnapshot', 'requestRoomList', 'requestPresence',
  'createRoom', 'joinRoom', 'leaveRoom', 'updateRoom', 'kickPlayer', 'selectDeck', 'setReady', 'ready', 'sendLobbyChat',
  'sendRoomChat', 'chatMessage', 'joinMatchmaking', 'leaveMatchmaking', 'acceptMatch', 'declineMatch', 'submitTurn', 'undoTurn',
  'lockTurn', 'raiseBanner', 'withdraw', 'requestSync', 'requestRematch', 'returnToLobby', 'practice', 'pong'
]);

const objectValue = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stringWithin = (value: unknown, maximum: number, allowEmpty = false): boolean => typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0);
const roomIdValid = (value: unknown): boolean => stringWithin(value, 80);
const gameIdValid = (value: unknown): boolean => value === undefined || stringWithin(value, 100);
const stringArray = (value: unknown, maximumItems: number, maximumLength: number): boolean => Array.isArray(value) && value.length <= maximumItems && value.every((item) => stringWithin(item, maximumLength));

export function validateClientAction(value: unknown): string[] {
  if (!objectValue(value)) return ['Action must be an object.'];
  const errors: string[] = [];
  if (!stringWithin(value.action, 40) || !KNOWN_ACTIONS.has(value.action as string)) errors.push('Unknown action.');
  if (!stringWithin(value.requestId, 128)) errors.push('requestId is required.');
  if (!stringWithin(value.protocolVersion, 40)) errors.push('protocolVersion is required.');
  if (errors.length > 0) return errors;
  const action = value.action as string;
  if (action === 'authenticate' && !stringWithin(value.password, 128, true)) errors.push('Invalid password.');
  if (action === 'join' && !stringWithin(value.name, LOBBY_LIMITS.playerName)) errors.push('Invalid player name.');
  if (action === 'join' && value.reconnectToken !== undefined && !stringWithin(value.reconnectToken, 200)) errors.push('Invalid reconnect token.');
  if (['joinRoom', 'leaveRoom', 'updateRoom', 'kickPlayer', 'setReady', 'sendRoomChat', 'acceptMatch', 'declineMatch'].includes(action) && !roomIdValid(value.roomId)) errors.push('Invalid roomId.');
  if (['submitTurn', 'undoTurn', 'lockTurn', 'raiseBanner', 'withdraw', 'requestRematch', 'returnToLobby'].includes(action) && !gameIdValid(value.gameId)) errors.push('Invalid gameId.');
  if (action === 'createRoom') {
    if (!objectValue(value.room)) errors.push('Room settings are required.');
    else {
      if (!stringWithin(value.room.name, LOBBY_LIMITS.roomName)) errors.push('Invalid room name.');
      if (!['public', 'private'].includes(String(value.room.visibility))) errors.push('Invalid room visibility.');
      if (value.room.password !== undefined && !stringWithin(value.room.password, 128, true)) errors.push('Invalid room password.');
      if (!Number.isFinite(value.room.turnDurationMs)) errors.push('Invalid turn duration.');
      if (!stringArray(value.room.packIds, 20, 80)) errors.push('Invalid content packs.');
      if (!stringArray(value.room.tags, LOBBY_LIMITS.roomTags, LOBBY_LIMITS.roomTag)) errors.push('Invalid room tags.');
    }
  }
  if (action === 'updateRoom' && !objectValue(value.patch)) errors.push('Room patch is required.');
  if (action === 'kickPlayer' && !stringWithin(value.playerId, 80)) errors.push('Invalid playerId.');
  if (action === 'selectDeck' && (!Array.isArray(value.cardIds) || value.cardIds.some((cardId) => !stringWithin(cardId, 120)))) errors.push('Invalid deck cards.');
  if (action === 'setReady' && typeof value.ready !== 'boolean') errors.push('ready must be boolean.');
  if (['sendLobbyChat', 'sendRoomChat', 'chatMessage'].includes(action) && !stringWithin(value.message, LOBBY_LIMITS.chatMessage)) errors.push('Invalid chat message.');
  if (action === 'joinMatchmaking' && !objectValue(value.deck)) errors.push('A deck is required for matchmaking.');
  if (action === 'submitTurn' && !objectValue(value.intent)) errors.push('Turn intent is required.');
  if (['undoTurn', 'lockTurn', 'raiseBanner', 'withdraw'].includes(action) && !Number.isInteger(value.turn)) errors.push('turn must be an integer.');
  if (action === 'practice' && (!Array.isArray(value.cardIds) || value.cardIds.some((cardId) => !stringWithin(cardId, 120)))) errors.push('Invalid practice deck.');
  return errors;
}

export function isClientAction(value: unknown): value is ClientAction {
  return validateClientAction(value).length === 0;
}
