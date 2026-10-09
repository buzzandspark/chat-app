import { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE } from "@shared/forks";

/** What Haiku returns; plain so the schema stays within structured outputs' subset. Lengths are clamped after parsing. */
export const OptionsOutput = z.object({ is_choice: z.boolean(), options: z.array(z.object({ title: z.string(), prompt: z.string() })) });

/** What routes accept from the sheet. */
export const ForkOptionBody = z.object({
  title: z.string().trim().min(1).max(MAX_OPTION_TITLE),
  prompt: z.string().trim().min(1).max(MAX_OPTION_PROMPT),
});
export const ForkOptionsBody = z.array(ForkOptionBody).min(1).max(MAX_FORKS);
