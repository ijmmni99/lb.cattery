// Shared by all public pages. Loaded before the page script (both are deferred, so order is preserved).
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
})();
