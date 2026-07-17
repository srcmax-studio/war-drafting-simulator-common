export const LOBBY_LIMITS = {
  playerName: 24,
  roomName: 48,
  chatMessage: 300,
  roomTags: 5,
  roomTag: 20,
  recentChatMessages: 100
} as const;

export type PresenceStatus = 'lobby' | 'room' | 'game' | 'reconnecting';
export type LatencyBucket = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
export type RoomVisibility = 'public' | 'private';
export type RoomStatus = 'open' | 'ready' | 'starting' | 'playing' | 'finished';
export type MatchmakingStatus = 'idle' | 'queued' | 'found' | 'confirming';

export interface PresenceEntry {
  playerId: string;
  name: string;
  status: PresenceStatus;
  joinedAt: number;
  latency: LatencyBucket;
}

export interface LobbyChatMessage {
  messageId: string;
  scope: 'lobby' | 'room';
  roomId?: string;
  senderId: string | null;
  senderName: string;
  kind: 'player' | 'system';
  content: string;
  createdAt: number;
}

export interface RoomSettings {
  visibility: RoomVisibility;
  passwordProtected: boolean;
  maxPlayers: 2;
  allowSpectators: boolean;
  turnDurationMs: number;
  packIds: string[];
  tags: string[];
  revealDecks: boolean;
}

export interface RoomMember {
  playerId: string;
  name: string;
  role: 'host' | 'player';
  connected: boolean;
  ready: boolean;
  deckId: string | null;
  deckName: string | null;
  deckValid: boolean;
  joinedAt: number;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  hostId: string;
  hostName: string;
  players: number;
  maxPlayers: 2;
  spectators: number;
  status: RoomStatus;
  settings: RoomSettings;
  createdAt: number;
  updatedAt: number;
  gameId: string | null;
}

export interface RoomState extends RoomSummary {
  members: RoomMember[];
  chat: LobbyChatMessage[];
}

export interface MatchmakingState {
  status: MatchmakingStatus;
  queuedAt: number | null;
  elapsedMs: number;
  queueSize: number;
  ticketId: string | null;
  roomId: string | null;
  acceptBy: number | null;
  acceptedPlayerIds: string[];
  mmrBand?: { minimum: number; maximum: number };
}

export interface ServerStatus {
  ok: boolean;
  status: 'starting' | 'ready' | 'draining';
  nodeId: string;
  title: string;
  owner: string;
  requirePassword: boolean;
  tls: boolean;
  connectedUsers: number;
  lobbyUsers: number;
  rooms: number;
  activeGames: number;
  matchmakingUsers: number;
  uptime: number;
  protocolVersion: string;
  catalogVersion: string;
  enabledFronts: number;
}

export interface LobbySnapshot {
  server: ServerStatus;
  self: PresenceEntry;
  presence: PresenceEntry[];
  rooms: RoomSummary[];
  chat: LobbyChatMessage[];
  matchmaking: MatchmakingState;
}

export interface StructuredProtocolError {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
  details?: Record<string, unknown>;
}
