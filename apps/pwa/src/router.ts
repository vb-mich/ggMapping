// Hash routing between the app's screens: the Simulator (default), My map
// (the digitalizer) with the scan flow and panel detail as sub-routes so the
// phone's back button walks out of them naturally, and the Rulebook with a
// heading anchor as its sub-route (deep links for rules questions).
import { signal } from "@preact/signals";

export type Route =
  | { screen: "sim" }
  | { screen: "atlas" }
  | { screen: "scan" }
  | { screen: "panel"; tx: number; ty: number }
  | { screen: "profile" }
  | { screen: "profile-playback" }
  | { screen: "profile-maps" }
  | { screen: "rules"; anchor: string | null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "profile") {
    if (parts[1] === "playback") return { screen: "profile-playback" };
    if (parts[1] === "maps") return { screen: "profile-maps" };
    return { screen: "profile" };
  }
  if (parts[0] === "rules") {
    // #/rules/<slug-of-heading>, or #/rules/ch/<n> to survive a retitle
    const anchor = parts.slice(1).join("/");
    return { screen: "rules", anchor: anchor || null };
  }
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

// Where the profile's back arrow returns to: the last screen outside it.
export const beforeProfile = signal("#/map");

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const prev = route.value;
    route.value = parseRoute(location.hash);
    if (
      route.value.screen.startsWith("profile") &&
      !prev.screen.startsWith("profile")
    ) {
      beforeProfile.value = prev.screen === "sim" ? "#/" : "#/map";
    }
  });
}

export function go(hash: string): void {
  location.hash = hash;
}

export const panelHash = (tx: number, ty: number) => `#/map/panel/${tx}/${ty}`;
export const rulesHash = (slug?: string) => (slug ? `#/rules/${slug}` : "#/rules");
