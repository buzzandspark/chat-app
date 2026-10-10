import { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE } from "@shared/forks";

/** What Haiku returns for a reply: empty when it is not a choice. Plain strings: the SDK folds length limits into descriptions, and a limit would reject the whole answer. */
export const DetectOutput = z.object({
  options: z
    .array(
      z.object({
        title: z.string().describe("Names this alternative in at most four words, for a tab beside the others: distinct, specific, never numbered like 'Option 1'."),
        prompt: z
          .string()
          .describe(
            "The user's next message in this same conversation, first person, one to three sentences: picks this alternative by name, then asks for the depth the reply did not give, such as a concrete plan, the trade-offs or what would change. The reply is already in view, so no summary of it. Shape: 'Let's go with the managed service. What would the setup, running cost and failure modes look like for us?'",
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
