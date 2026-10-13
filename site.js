// Shared by all pages. Loaded before the page script (both are deferred, so order is preserved).
(function () {
  let settingsPromise = null;

  // Memoised so several scripts on one page share a single /api/settings request.
  window.lbFetchSettings = function lbFetchSettings() {
    if (!settingsPromise) {
      settingsPromise = fetch("/api/settings")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }
    return settingsPromise;
  };

  // Digits-only WhatsApp number from admin settings, or "" when unset.
  window.lbWhatsappNumber = function lbWhatsappNumber(settings) {
    return String(settings?.contact?.whatsappNumber || "").replace(/\D/g, "");
  };

  window.lbWhatsappUrl = function lbWhatsappUrl(number, text) {
    return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  };

  // One line per cat, e.g. "Mimi (Persian, 2y, vaccinated 2026-03-01)". Reads legacy single-cat columns too.
  window.lbCatsLabel = function lbCatsLabel(row) {
    const cats = Array.isArray(row.cats) && row.cats.length
      ? row.cats
      : row.cat_name
        ? [{ name: row.cat_name, breed: row.breed, age: row.age }]
        : [];
    if (!cats.length) return "-";
    return cats
      .map((cat) => {
        const parts = [cat.breed || "-", `${cat.age ?? "-"}y`];
        if (cat.vaccinated === true) parts.push(cat.vaccinationDate ? `vaccinated ${cat.vaccinationDate}` : "vaccinated");
        else if (cat.vaccinated === false) parts.push("vaccination not confirmed");
        return `${cat.name || "-"} (${parts.join(", ")})`;
      })
      .join("; ");
  };

  function addWhatsappButton(number) {
    if (!number || document.body.hasAttribute("data-no-whatsapp")) return;
    const link = document.createElement("a");
    link.className = "whatsapp-fab";
    link.href = window.lbWhatsappUrl(number, "Hi L&B Cattery, I have a question.");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Chat with us on WhatsApp");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "💬";
    const label = document.createElement("span");
    label.className = "whatsapp-fab-label";
    label.textContent = "WhatsApp";
    link.append(icon, label);
    document.body.appendChild(link);
  }

  window.lbFetchSettings().then((settings) => addWhatsappButton(window.lbWhatsappNumber(settings)));
})();
