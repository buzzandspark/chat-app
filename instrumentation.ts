// D3: boot work and the SIGTERM drain. Next's own exit-on-signal handler is disabled by
// NEXT_MANUAL_SIG_HANDLE=true in the Dockerfile.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./src/server/boot");
    await boot();
  }
}

/** D25: server-side errors go to Sentry when a DSN is configured. */
export async function onRequestError(err: unknown, request: { path: string; method: string }): Promise<void> {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== "nodejs") return;
  const [Sentry, { redactInvitePath }] = await Promise.all([import("@sentry/node"), import("./src/shared/redact")]);
  // `beforeSend` redacts the event too; the path is the one field set here, so it never leaves unredacted.
  Sentry.captureException(err, { extra: { path: redactInvitePath(request.path), method: request.method } });
}
