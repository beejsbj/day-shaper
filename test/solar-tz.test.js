// Runs in its own process so the time zone can be pinned.
process.env.TZ = "Europe/London";
const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { guessLocation, sunForDate } = await import("../src/solar.js");

test("the guessed longitude ignores summer time", () => {
  const june = new Date(2026, 5, 21, 12);
  const loc = guessLocation(june);
  assert.equal(loc.lon, 0);                               // GMT, not BST's +15°
  const sun = sunForDate(june, loc);
  assert.ok(Math.abs(sun.sunrise - (4 + 43 / 60)) < 0.1, "sunrise " + sun.sunrise);
  assert.ok(Math.abs(sun.sunset - (21 + 21 / 60)) < 0.1, "sunset " + sun.sunset);
});
