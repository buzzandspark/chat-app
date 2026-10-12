import { eq } from "drizzle-orm";
import { generations, messages, usageEvents } from "@db/schema";
import { uuidv7 } from "@shared/id";
import { costOf } from "./anthropic/pricing";
import { isBillableProvider } from "./providers/types";
import { CHARS_PER_TOKEN, type QuotaManager, type SpendDb } from "./quota";

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
 * Marks a generation whose process died as interrupted and settles a cost estimated from its saved text at CHARS_PER_TOKEN,
 * thinking counted as output. A non-billable run gets its usage row at cost zero and never touches spend, so a restart mid-scenario cannot eat a cap.
 */
export function settleOrphan(tx: SpendDb, row: OrphanRow, now: Date, quota: QuotaManager): number {
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
  const tokens = { inputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN), outputTokens: Math.ceil(outputChars / CHARS_PER_TOKEN), cacheReadTokens: 0, cacheWriteTokens: 0 };
  const costUsd = isBillableProvider(row.provider) ? costOf(model, tokens) : 0;
  tx.insert(usageEvents)
    .values({ id: uuidv7(), generationId: row.id, userId: row.userId, model, iterationType: "message", ...tokens, costUsd, estimated: true, createdAt: now })
    .run();
  quota.spend(tx, row.userId, costUsd);
  return costUsd;
}
