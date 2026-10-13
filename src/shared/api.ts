import type { Duplicate, StartedFork, Winner } from "@relay/forks";
import type { AdminUserRow } from "@server/admin";
import type { ChatDetail, MessageRow } from "@server/chats";
import type { ForkOption, OptionsTrace } from "./forks";

// The bodies our routes answer with: each route checks its body against one of these with `satisfies`.

/** Every failed request's body; `error` is a code, the rest are details only some failures carry. */
export interface ApiError {
  error: string;
  retryAfterMs?: number;
  spentUsd?: number;
  capUsd?: number | null;
  /** zod's issues on a 400. */
  issues?: { code: string; path: PropertyKey[] }[];
}

/** better-auth answers its own endpoints (`/api/auth/*`); a failed sign-in carries a message to show. */
export interface AuthError {
  code?: string;
  message?: string;
}

export interface OkResponse {
  ok: true;
}

export type ChatResponse = { chat: ChatDetail; messages: MessageRow[]; older: number };

export interface SearchHit {
  chatId: string;
  title: string;
  snippet: string | null;
  /** The chat's newest matching message, which opening the hit scrolls to; null for a title match. */
  messageId: string | null;
  updatedAt: number;
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface CapUsage {
  spentUsd: number;
  capUsd: number | null;
}

export interface ForkResponse {
  forks: StartedFork[];
  /** Why the forks missing from `forks` could not start. */
  failed?: ApiError;
}

export type DuplicateResponse = Duplicate;

export type DeclareWinnerResponse = Winner & { lastMessageId: string | null };

export interface DeleteForksResponse {
  deleted: string[];
}

export interface RewriteResponse {
  options: ForkOption[];
  trace: OptionsTrace | null;
}

export interface StopResponse {
  stopped: boolean;
}

export interface SeedLongChatResponse {
  chatId: string;
  messages: number;
}

export interface RedeemInviteResponse {
  ok: true;
  email: string;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
}

export interface InviteResponse {
  inviteUrl: string;
  expiresAt: number;
}

export type CreateUserResponse = InviteResponse & { id: string };

/** The one unchecked step: the body is trusted to be what its route declares. */
export function readJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
