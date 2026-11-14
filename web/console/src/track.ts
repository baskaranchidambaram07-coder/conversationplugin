// The onboarding track (the console's direction contract): every widget is a journey of six stations to go-live,
// each signed with the minutes it takes, and the track signs the time left. Only the next station is open.

export type StationId = "agent" | "sites" | "sign-in" | "look" | "install" | "live";
export type Station = { id: StationId; minutes: number; state: "done" | "now" | "next" };

export type Standing = {
  /** Steps a new widget has finished in the console; an existing widget has finished the first four. */
  set: StationId[];
  /** The live version, if published. */
  version: number | null;
  /** The draft holds changes visitors do not see yet. */
  unpublished: boolean;
  /** Visitors sign in: the sign-in settings and the install take longer (a backend endpoint on the portal). */
  signedIn: boolean;
};

const ORDER: StationId[] = ["agent", "sites", "sign-in", "look", "install", "live"];

export function minutes(id: StationId, signedIn: boolean): number {
  return { agent: 5, sites: 2, "sign-in": signedIn ? 8 : 3, look: 4, install: signedIn ? 20 : 3, live: 2 }[id];
}

export function stations({ set, version, unpublished, signedIn }: Standing): Station[] {
  const done = (id: StationId) =>
    set.includes(id) || (id === "install" && version !== null) || (id === "live" && version !== null && !unpublished);
  const first = ORDER.find((id) => !done(id));
  return ORDER.map((id) => ({
    id,
    minutes: minutes(id, signedIn),
    state: done(id) ? "done" : id === first ? "now" : "next",
  }));
}

/** Minutes of the stations not yet done: the time left to go-live. */
export const timeLeft = (track: Station[]) =>
  track.filter((station) => station.state !== "done").reduce((sum, station) => sum + station.minutes, 0);
