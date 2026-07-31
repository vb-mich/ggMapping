// Service-worker update flow: when a newer build is waiting, a button appears;
// clicking it activates the new worker and reloads. A periodic check lets
// long-lived tabs learn about new deploys without a manual reload.
import { signal } from "@preact/signals";
import { registerSW } from "virtual:pwa-register";

export const updateAvailable = signal(false);

const CHECK_EVERY_MS = 15 * 60 * 1000;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
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
