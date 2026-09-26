/* Offline physical-feature matching. Coordinates stay on this device: the
   bundled data is fetched without putting a location in its URL. */

const EARTH_KM_PER_LAT = 110.574;
const NEAR_KM = 30;

const validLocation = (loc) => Number.isFinite(loc?.lat) && Number.isFinite(loc?.lon)
  && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180;
const unwrap = (lon, around) => around + ((((lon - around) + 540) % 360) - 180);

function pointInRing(point, ring) {
  let inside = false;
  // Unwrap around the feature, not the observer: otherwise a dateline ring
  // appears to enclose Greenwich on the opposite side of the planet.
  const origin = ring[0][0], longitude = unwrap(point.lon, origin);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const ax = unwrap(a[0], origin), bx = unwrap(b[0], origin);
    if ((a[1] > point.lat) !== (b[1] > point.lat)
      && longitude < (bx - ax) * (point.lat - a[1]) / (b[1] - a[1]) + ax) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const scale = Math.cos(point.lat * Math.PI / 180);
  const ax = (unwrap(a[0], point.lon) - point.lon) * 111.320 * scale;
  const ay = (a[1] - point.lat) * EARTH_KM_PER_LAT;
  const bx = (unwrap(b[0], unwrap(a[0], point.lon)) - point.lon) * 111.320 * scale;
  const by = (b[1] - point.lat) * EARTH_KM_PER_LAT;
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function ringDistance(point, ring, closed) {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) best = Math.min(best, distanceToSegment(point, ring[i - 1], ring[i]));
  if (closed && ring.length > 2) best = Math.min(best, distanceToSegment(point, ring[ring.length - 1], ring[0]));
  return best;
}

function polygons(coordinates) {
  // Polygon rings are [[lon, lat]...]; MultiPolygon has one more level.
  return typeof coordinates[0]?.[0]?.[0] === "number" ? [coordinates] : coordinates;
}

function polygonMatch(point, coordinates) {
  let distance = Infinity;
  for (const polygon of polygons(coordinates)) {
    if (pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))) return { inside: true, distance: 0 };
    for (const ring of polygon) distance = Math.min(distance, ringDistance(point, ring, true));
  }
  return { inside: false, distance };
}

function lineDistance(point, lines) {
  return lines.reduce((best, line) => Math.min(best, ringDistance(point, line, false)), Infinity);
}

function couldBeNear([west, south, east, north], point) {
  const latitudePad = NEAR_KM / EARTH_KM_PER_LAT;
  if (point.lat < south - latitudePad || point.lat > north + latitudePad) return false;
  if (east - west >= 180) return true; // a broad or antimeridian bbox: don't exclude it
  const longitudePad = Math.min(180, NEAR_KM / Math.max(1, 111.320 * Math.cos(point.lat * Math.PI / 180)));
  const localLon = unwrap(point.lon, (west + east) / 2);
  return localLon >= west - longitudePad && localLon <= east + longitudePad;
}

/** Return the closest actual local feature from a compact geography payload. */
export function matchGeography(data, loc) {
  if (!validLocation(loc) || !Array.isArray(data?.features)) return null;
  const point = { lat: loc.lat, lon: loc.lon };
  let contained = null, nearby = null;
  for (const feature of data.features) {
    const [name, type, shape, bbox, coordinates] = feature;
    if (typeof name !== "string" || !Array.isArray(bbox) || !Array.isArray(coordinates) || !couldBeNear(bbox, point)) continue;
    const result = shape === "P" ? polygonMatch(point, coordinates) : { inside: false, distance: lineDistance(point, coordinates) };
    if (result.inside) {
      const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
      if (!contained || area < contained.area) contained = { name, type, relation: "inside", distanceKm: 0, area };
    } else if (result.distance <= NEAR_KM && (!nearby || result.distance < nearby.distanceKm)) {
      nearby = { name, type, relation: "near", distanceKm: result.distance };
    }
  }
  // A shore or river within a couple of kilometres is more useful than a
  // very broad containing plain/desert (Toronto is near Lake Ontario, not
  // meaningfully "in the Central Lowlands"). Farther features remain a
  // secondary local cue to the containing terrain.
  if (nearby && nearby.distanceKm <= 2) return nearby;
  return contained || nearby;
}

export const LOCAL_FEATURE_DISTANCE_KM = NEAR_KM;
