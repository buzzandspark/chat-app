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
