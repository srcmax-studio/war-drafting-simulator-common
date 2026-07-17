import type { GameEvent, PlayerView, TurnIntent } from './types.js';

export type ClientAction =
  | { action: 'status'; protocolVersion: string; requestId: string }
  | { action: 'authenticate'; protocolVersion: string; requestId: string; password: string }
  | { action: 'join'; protocolVersion: string; requestId: string; name: string; reconnectToken?: string }
  | { action: 'selectDeck'; protocolVersion: string; requestId: string; deckId?: string; cardIds: string[] }
  | { action: 'ready'; protocolVersion: string; requestId: string }
  | { action: 'submitTurn'; protocolVersion: string; requestId: string; intent: TurnIntent }
  | { action: 'undoTurn'; protocolVersion: string; requestId: string; turn: number }
  | { action: 'lockTurn'; protocolVersion: string; requestId: string; turn: number }
  | { action: 'raiseBanner'; protocolVersion: string; requestId: string; turn: number }
  | { action: 'withdraw'; protocolVersion: string; requestId: string; turn: number }
  | { action: 'requestSync'; protocolVersion: string; requestId: string }
  | { action: 'requestRematch'; protocolVersion: string; requestId: string }
  | { action: 'practice'; protocolVersion: string; requestId: string; deckId?: string; cardIds: string[] }
  | { action: 'chatMessage'; protocolVersion: string; requestId: string; message: string }
  | { action: 'pong'; protocolVersion: string; requestId: string };

export type ServerEvent =
  | { event: 'serverStatus'; protocolVersion: string; sequence: number; requestId?: string; payload: Record<string, unknown> }
  | { event: 'roomState'; protocolVersion: string; sequence: number; requestId?: string; payload: Record<string, unknown> }
  | { event: 'privateGameState'; protocolVersion: string; sequence: number; requestId?: string; payload: PlayerView }
  | { event: 'publicGameState'; protocolVersion: string; sequence: number; requestId?: string; payload: PlayerView }
  | { event: 'gameEventBatch'; protocolVersion: string; sequence: number; requestId?: string; payload: GameEvent[] }
  | { event: 'turnAccepted' | 'turnRejected' | 'turnLocked' | 'turnResolved'; protocolVersion: string; sequence: number; requestId?: string; payload: Record<string, unknown> }
  | { event: 'bannerRaised' | 'stakeChanged' | 'playerWithdrew' | 'gameEnded' | 'reconnected'; protocolVersion: string; sequence: number; requestId?: string; payload: Record<string, unknown> }
  | { event: 'error'; protocolVersion: string; sequence: number; requestId?: string; payload: { code: string; message: string; details?: Record<string, unknown> } };

export function isClientAction(value: unknown): value is ClientAction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.action === 'string' && typeof candidate.requestId === 'string' && typeof candidate.protocolVersion === 'string';
}
