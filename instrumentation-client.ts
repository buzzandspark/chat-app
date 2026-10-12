// Runs once in the browser, before the app is interactive (Next's client instrumentation hook).

// D19: the keyboard height, as --keyboard-inset and data-keyboard, for the composer and sheets.
const vv = window.visualViewport;
if (vv) {
  const root = document.documentElement;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    root.dataset.keyboard = inset > 80 ? "open" : "closed";
  };
  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
}

// D25: the minimal Sentry client loads in idle time after first paint, outside the route bundle.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  const start = () => void import("@client/monitoring/sentry").then(({ startSentry }) => startSentry(dsn));
  if ("requestIdleCallback" in window) window.requestIdleCallback(start);
  else setTimeout(start, 2000);
}
