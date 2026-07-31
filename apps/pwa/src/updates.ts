// Service-worker update flow.
//
// A new build discovered AT PAGE LOAD applies itself immediately (one quick
// self-reload): refreshing the page is expected to land on the newest
// version. A new build discovered MID-SESSION becomes the "Update to newer
// version" button — nothing swaps out from under a running session. A
// periodic check lets long-lived tabs learn about new deploys.
import { signal } from "@preact/signals";
import { registerSW } from "virtual:pwa-register";

export const updateAvailable = signal(false);

const CHECK_EVERY_MS = 15 * 60 * 1000;
const AUTO_APPLY_WINDOW_MS = 3000;
const AUTO_APPLY_GUARD = "jm-auto-update"; // one self-reload per tab session
const loadedAt = Date.now();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const atLoad = Date.now() - loadedAt < AUTO_APPLY_WINDOW_MS;
    if (atLoad && sessionStorage.getItem(AUTO_APPLY_GUARD) !== "1") {
      sessionStorage.setItem(AUTO_APPLY_GUARD, "1");
      applyUpdate();
      return;
    }
    updateAvailable.value = true;
  },
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update(), CHECK_EVERY_MS);
  },
});

export function applyUpdate(): void {
  void updateSW(true);
  // A page that was never controlled (the very first visit) gets no
  // controllerchange event; reload explicitly once the new worker is in.
  setTimeout(() => window.location.reload(), 1200);
}
