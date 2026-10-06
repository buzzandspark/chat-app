/**
 * `register()` runs once at server start (D3): migrations, the boot backstop
 * that marks any still-`running` generation as interrupted, the demo purge
 * timer, and the SIGTERM drain handler. Next.js skips its own immediate-exit
 * signal handler because the Dockerfile sets NEXT_MANUAL_SIG_HANDLE=true.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./src/server/boot");
    await boot();
  }
}

/** D25: server-side errors go to Sentry when a DSN is configured. */
export async function onRequestError(err: unknown, request: { path: string; method: string }): Promise<void> {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/node");
  Sentry.captureException(err, { extra: { path: request.path, method: request.method } });
}
