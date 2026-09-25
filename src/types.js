/* The five clays. `c0`/`c1` are the lit and shaded faces of the block on the
   ring; `orb` is the material the central orb takes while you are inside one.
   Work is sage because focus is green in the mood board's forest; movement is
   the warm coral of effort. */

export const TYPES = [
  { id: "sleep", name: "Sleep", mood: "Good night", icon: "sleep", len: 8,
    c0: "#a3b0e0", c1: "#6a7bbd", orb: { hi: "#7390cf", mid: "#42599c", lo: "#263777", ink: "#f2f5fd" } },
  { id: "work", name: "Work", mood: "Focus", icon: "work", len: 2,
    c0: "#a3c9ae", c1: "#6c9c7d", orb: { hi: "#9cc4a6", mid: "#62906f", lo: "#3e6a4f", ink: "#f4f8f4" } },
  { id: "eat", name: "Eat", mood: "Nourish", icon: "eat", len: 0.75,
    c0: "#f3d38f", c1: "#dcae5c", orb: { hi: "#fbe2a8", mid: "#efc06b", lo: "#d49c45", ink: "#6b4716" } },
  { id: "move", name: "Move", mood: "Move", icon: "move", len: 1,
    c0: "#f5b793", c1: "#e08c68", orb: { hi: "#fdcaa6", mid: "#f3a47c", lo: "#d9805a", ink: "#74351e" } },
  { id: "rest", name: "Rest", mood: "Unwind", icon: "rest", len: 1,
    c0: "#eab0c8", c1: "#c983a2", orb: { hi: "#f4c6da", mid: "#df9cba", lo: "#bb7494", ink: "#6a2d4a" } },
];

export const TYPE_IDS = TYPES.map((t) => t.id);
const byId = Object.fromEntries(TYPES.map((t) => [t.id, t]));
export const typeOf = (id) => byId[id] || TYPES[0];

/** A believable weekday to start from: sleep crosses midnight, focus until 12:30,
    bedtime at 11:30 PM (the mood board's own numbers). */
export function sampleDay(uid) {
  return [
    { type: "sleep", start: 23.5, len: 7.5 },
    { type: "move", start: 7.25, len: 0.75 },
    { type: "eat", start: 8, len: 0.5 },
    { type: "work", start: 9, len: 3.5 },
    { type: "eat", start: 12.75, len: 0.75 },
    { type: "work", start: 14, len: 3 },
    { type: "move", start: 17.5, len: 1 },
    { type: "eat", start: 19, len: 0.75 },
    { type: "rest", start: 20.5, len: 1.5 },
  ].map((b) => ({ id: uid(), ...b }));
}
