document.getElementById("offline-retry").addEventListener("click", () => {
  window.location.href = "/";
});

// The service worker serves the last successful /api/settings response when offline.
fetch("/api/settings")
  .then((res) => (res.ok ? res.json() : null))
  .then((settings) => {
    const number = String(settings?.contact?.whatsappNumber || "").replace(/\D/g, "");
    if (!number) return;
    const link = document.getElementById("offline-whatsapp-link");
    link.href = `https://wa.me/${number}`;
    link.textContent = `+${number}`;
    document.getElementById("offline-whatsapp").hidden = false;
  })
  .catch(() => {});
