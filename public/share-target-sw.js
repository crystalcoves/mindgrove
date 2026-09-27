/*
 * Share target: "Share → Mindgrove" posts here (see the manifest). A shared
 * audio file is parked in a cache for the app to pick up and transcribe; shared
 * text/links are passed on in the URL as before. Loaded into the generated
 * service worker with importScripts, so this listener runs before Workbox's.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/share-target")) return;
  const base = url.pathname.replace(/share-target$/, "");
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const q = new URLSearchParams();
        for (const k of ["title", "text", "url"]) {
          const v = form.get(k);
          if (typeof v === "string" && v.trim()) q.set(k, v);
        }
        const file = form.getAll("audio").find((f) => f && typeof f === "object" && f.size > 0);
        if (file) {
          const cache = await caches.open("mindgrove-shared");
          await cache.put(
            `${base}__shared-audio`,
            new Response(file, {
              headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "") },
            }),
          );
          q.set("share-audio", "1");
        }
        const qs = q.toString();
        return Response.redirect(`${base}${qs ? `?${qs}` : ""}`, 303);
      } catch {
        return Response.redirect(`${base}?share=failed`, 303);
      }
    })(),
  );
});
