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
 * A generation whose process died while it ran: mark it interrupted and settle an estimated cost from
 * the saved text at four characters per token (no usage was written). Shared by the boot backstop and
 * by `Engine.resume`, which used to mark without settling (cap review, finding 3). The serving model is
 * read from the message, which the partial writer keeps current, and thinking text counts as output
 * (finding 5). A run that spends nothing (D22) still gets its estimated usage row, with its tokens
 * kept and cost zero as `Engine.free` writes them, and never touches the user's spend, so a restart
 * mid-scenario cannot eat a cap.
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
