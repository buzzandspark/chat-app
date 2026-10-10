import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const events = [];
page.on("framenavigated", (f) => { if (f === page.mainFrame()) events.push(`navigated: ${f.url()}`); });
page.on("websocket", (ws) => ws.on("framereceived", (f) => { const p = String(f.payload); if (p.includes('"restart"') || p.includes('"building"')) events.push(`hmr: ${p.slice(0, 160)}`); }));
page.on("console", (m) => { if (m.text().includes("Fast Refresh")) events.push(`console: ${m.text().slice(0, 100)}`); });
for (const path of ["/", `/c/${crypto.randomUUID()}`]) {
  events.push(`--- goto ${path}`);
  await page.goto(`http://localhost:3141${path}`, { waitUntil: "load" }).catch((e) => events.push(`goto failed: ${e.message.slice(0, 100)}`));
  await page.waitForTimeout(8000);
  events.push(`final url: ${page.url()}`);
}
console.log(events.join("\n"));
await browser.close();
