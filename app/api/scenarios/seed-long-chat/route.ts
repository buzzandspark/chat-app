import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";
import { GUEST_MODEL } from "@shared/models";
import { errorResponse, requireUser } from "@server/current-user";
import { getLimiters, tooMany } from "@server/ratelimit";

const FILLER = [
  "The relay keeps every generation in an in-memory buffer keyed by id, with sequence numbers as array indices.",
  "A client that reconnects asks for events after the last sequence it saw, and the server replays the slice before attaching it live.",
  "Partial content is written to SQLite every two seconds, so a crash loses at most two seconds of text.",
  "Stop is explicit: closing a tab never stops a generation, because the next device to open the chat should see the whole reply.",
];

/** Seeds 200 finished turns so the long-chat scenario measures real list cost. */
export async function POST(): Promise<Response> {
  try {
    const user = await requireUser();
    const limit = getLimiters().seedLongChat.check(user.id);
    if (!limit.ok) return tooMany(limit.retryAfterMs);
    const db = getDb();
    const chatId = uuidv7();
    const now = new Date();
    const turns = 100;
    // The chat opens on its last reply's model: a guest's must be one it can use.
    const model = user.role === "guest" ? GUEST_MODEL : "claude-sonnet-5-5";
    db.transaction((tx) => {
      tx.insert(schema.chats).values({ id: chatId, userId: user.id, title: "Scenario: extremely long chat", createdAt: now, updatedAt: now, lastMessageAt: now }).run();
      let position = 0;
      for (let i = 0; i < turns; i++) {
        tx.insert(schema.messages)
          .values({
            id: uuidv7(),
            chatId,
            role: "user",
            position: position++,
            content: [{ type: "text", text: `Question ${i + 1}: how does resume work when the radio drops?`, citations: null }],
            status: "done",
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const body = `**Answer ${i + 1}.** ${FILLER[i % FILLER.length]}\n\n- Sequence numbers are indices\n- Control events bypass dedupe\n\n\`\`\`ts\nconst seq = buffer.events.length; // turn ${i + 1}\n\`\`\``;
        tx.insert(schema.messages)
          .values({
            id: uuidv7(),
            chatId,
            role: "assistant",
            position: position++,
            content: [{ type: "text", text: body, citations: null }],
            status: "done",
            requestedModel: model,
            servingModel: model,
            stopReason: "end_turn",
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    });
    return Response.json({ chatId, messages: turns * 2 }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
