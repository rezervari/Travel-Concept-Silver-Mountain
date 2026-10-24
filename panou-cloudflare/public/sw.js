// Service worker minim (necesar ca panoul să se poată instala ca aplicație). Nu păstrează date: panoul conține
// date personale și coduri, deci totul vine mereu de la server. Fără internet → o pagină scurtă de avertizare.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Panou A13</title><body style="font-family:system-ui,sans-serif;padding:32px;color:#262626;background:#f5f5f5">' +
    "<h1 style=\"font-size:20px;color:#003580\">Panou A13</h1><p>Nu e conexiune la internet. Încearcă din nou când revine.</p>" +
    '<button onclick="location.reload()" style="font-size:16px;padding:10px 16px">Reîncearcă</button></body></html>',
    { headers: { "content-type": "text/html; charset=utf-8" } })));
});
