import { z } from "zod";
import { FALLBACK_DEFAULT_COST_CAP_USD, MAX_COST_CAP_USD, NO_CAP } from "./cost-cap";

/**
 * A cap in an admin API body. z.number() already refuses NaN and ±Infinity; `null` is refused too,
 * because JSON carries a client's NaN as `null` (see NO_CAP).
 */
export const CapFieldSchema = z.union([z.number().min(0).max(MAX_COST_CAP_USD), z.literal(NO_CAP)]);

/**
 * DEFAULT_COST_CAP_USD: positive, so a new account can always send something. A blank `KEY=` line in an
 * env file counts as unset rather than coercing to 0 and failing the boot.
 */
export const DefaultCapEnvSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().positive().max(MAX_COST_CAP_USD).default(FALLBACK_DEFAULT_COST_CAP_USD),
);
