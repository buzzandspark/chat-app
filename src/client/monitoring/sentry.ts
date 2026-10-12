import { BrowserClient, dedupeIntegration, defaultStackParser, globalHandlersIntegration, makeFetchTransport, setCurrentClient } from "@sentry/browser";
import { redactInviteTokens } from "@shared/redact";

/** Assembled from named imports: the convenience `init` pulls in every default integration (134 KiB gzipped). */
export function startSentry(dsn: string): void {
  const client = new BrowserClient({
    dsn,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [globalHandlersIntegration(), dedupeIntegration()],
    tracesSampleRate: 0,
    // An event raised on `/invite/<token>` carries the page URL; the token is a password-setting credential.
    beforeSend: redactInviteTokens,
    beforeSendTransaction: redactInviteTokens,
    beforeBreadcrumb: redactInviteTokens,
  });
  // The global handlers report through the current client; a detached Scope would drop every event.
  setCurrentClient(client);
  client.init();
}
