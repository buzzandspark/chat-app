/**
 * Fixed system prompt (D13). It is the first cache breakpoint and part of the
 * thinking-binding prefix, so it changes only on a deliberate deploy; the
 * `drop_block` setting in thinking-config.ts keeps existing chats working
 * when it does.
 */
export const SYSTEM_PROMPT = `You are Claude, in a chat app called Cadence. Be direct and concrete. Use Markdown: fenced code blocks with a language tag for code, tables for tabular comparisons, and short headings only for long answers. Match the length of the reply to the question.`;
