// Hash routing between the app's screens: the Simulator (default) and
// My map (the digitalizer), with the scan flow and panel detail as
// sub-routes so the phone's back button walks out of them naturally.
import { signal } from "@preact/signals";

export type Route =
  | { screen: "sim" }
  | { screen: "atlas" }
  | { screen: "scan" }
  | { screen: "panel"; tx: number; ty: number };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "map") return { screen: "sim" };
  if (parts[1] === "scan") return { screen: "scan" };
  if (parts[1] === "panel" && parts.length === 4) {
    const tx = Number(parts[2]);
    const ty = Number(parts[3]);
    if (Number.isInteger(tx) && Number.isInteger(ty) && tx !== 0 && ty !== 0) {
      return { screen: "panel", tx, ty };
    }
  }
  return { screen: "atlas" };
}

export const route = signal<Route>(
  typeof location !== "undefined" ? parseRoute(location.hash) : { screen: "sim" },
);

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    route.value = parseRoute(location.hash);
  });
}

export function go(hash: string): void {
  location.hash = hash;
}

export const panelHash = (tx: number, ty: number) => `#/map/panel/${tx}/${ty}`;
