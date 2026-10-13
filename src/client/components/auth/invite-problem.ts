const PROBLEMS: Record<string, string> = {
  used: "This invite has already been used.",
  expired: "This invite has expired.",
  revoked: "This invite was revoked.",
};

/** What an unusable invite tells its visitor, by the reason the invite lookup gave. */
export function inviteProblem(reason: string): string {
  return PROBLEMS[reason] ?? "This invite link isn't valid.";
}
