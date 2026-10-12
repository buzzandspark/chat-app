import { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE } from "@shared/forks";

/** Count first so it can be shown while the options stream. Plain strings: the SDK folds length limits into descriptions, and a limit would reject the whole answer. */
export const DetectOutput = z.object({
  count: z.number().describe("How many alternatives the reply lays out; 0 when none."),
  options: z
    .array(
      z.object({
        title: z.string().describe("At most four words naming this alternative; distinct, never 'Option 1'."),
        prompt: z
          .string()
          .describe(
            "One short sentence, the user's next message in this same conversation: picks this alternative by name and asks for a concrete plan. Example: 'Let's go with the managed service: what would setup, cost and failure modes look like for us?'",
          ),
      }),
    )
    .describe("Empty unless the reply is a choice. One item per alternative, in the reply's order."),
});

export const RewriteOutput = z.object({ options: z.array(z.object({ title: z.string(), prompt: z.string() })) });

/** What routes accept from the sheet. */
export const ForkOptionBody = z.object({
  title: z.string().trim().min(1).max(MAX_OPTION_TITLE),
  prompt: z.string().trim().min(1).max(MAX_OPTION_PROMPT),
});
export const ForkOptionsBody = z.array(ForkOptionBody).min(1).max(MAX_FORKS);
