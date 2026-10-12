import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { generations, messages, usageEvents, users } from "@db/schema";
import { uuidv7 } from "@shared/id";
import { costOf } from "./anthropic/pricing";
import { isBillableProvider } from "./providers/types";

export interface OrphanRow {
  id: string;
  messageId: string;
  chatId: string;
  userId: string;
  requestedModel: string;
  /** `generations.provider`: a scripted or replayed run settles at zero, as it would have finished. */
  provider: string;
}

/**
 * Marks a generation whose process died as interrupted and settles a cost estimated from its saved text at 4 chars/token,
 * thinking counted as output. A non-billable run gets its usage row at cost zero and never touches spend, so a restart mid-scenario cannot eat a cap.
 */
export function settleOrphan(tx: Db, row: OrphanRow, now: Date): number {
  tx.update(generations).set({ status: "interrupted", interruptedReason: "crash", endedAt: now }).where(eq(generations.id, row.id)).run();
  tx.update(messages).set({ status: "interrupted", updatedAt: now }).where(eq(messages.id, row.messageId)).run();
  const chatRows = tx
    .select({ id: messages.id, content: messages.content, servingModel: messages.servingModel })
    .from(messages)
    .where(eq(messages.chatId, row.chatId))
    .all();
  let inputChars = 0;
  let outputChars = 0;
  let servingModel: string | null = null;
  for (const m of chatRows) {
    if (m.id === row.messageId) servingModel = m.servingModel;
    for (const b of m.content) {
      const chars = b.type === "text" ? b.text.length : b.type === "thinking" ? b.thinking.length : 0;
      if (m.id === row.messageId) outputChars += chars;
      else if (b.type === "text") inputChars += chars;
    }
  }
  const model = servingModel ?? row.requestedModel;
  const tokens = { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(outputChars / 4), cacheReadTokens: 0, cacheWriteTokens: 0 };
  const costUsd = isBillableProvider(row.provider) ? costOf(model, tokens) : 0;
  tx.insert(usageEvents)
    .values({ id: uuidv7(), generationId: row.id, userId: row.userId, model, iterationType: "message", ...tokens, costUsd, estimated: true, createdAt: now })
    .run();
  if (costUsd > 0) tx.update(users).set({ costSpentUsd: sql`${users.costSpentUsd} + ${costUsd}` }).where(eq(users.id, row.userId)).run();
  return costUsd;
}
