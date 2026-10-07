import { BrowserClient, dedupeIntegration, defaultStackParser, globalHandlersIntegration, makeFetchTransport, setCurrentClient } from "@sentry/browser";

/**
 * D25: the minimal client, assembled from named imports so the bundler keeps only what is used (the
 * convenience `init` drags in every default integration, 134 KiB gzipped for the 31 that errors need).
 */
export function startSentry(dsn: string): void {
  const client = new BrowserClient({
    dsn,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [globalHandlersIntegration(), dedupeIntegration()],
    tracesSampleRate: 0,
  });
  // The global handlers report through the current client; a detached Scope would drop every event.
  setCurrentClient(client);
  client.init();
}
