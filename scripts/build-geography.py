#!/usr/bin/env python3
"""Build the small, offline physical-geography index used by Dayshaper.

The input files are pinned Natural Earth GeoJSON.  Run this from the repository
root; it only needs Python's standard library and writes data/geography.json.
"""

import json
import math
import urllib.request
from pathlib import Path

COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/%s/geojson/" % COMMIT
SOURCES = (
    ("ne_10m_geography_regions_polys.geojson", "regions"),
    ("ne_10m_rivers_lake_centerlines.geojson", "river"),
    ("ne_10m_lakes.geojson", "lake"),
)
REGION_CLASSES = {"Range/mtn": "mountain", "Desert": "desert", "Plain": "plain", "Valley": "valley"}
TOLERANCE = 0.01  # degrees; subsequent rounding is to three decimal places


def get_source(filename):
    with urllib.request.urlopen(BASE + filename) as response:
        return json.load(response)


def name_of(properties):
    return properties.get("NAME_EN") or properties.get("name_en") or properties.get("NAME") or properties.get("name")


def display_name(name, source):
    if source == "lake" and not any(word in name.lower() for word in ("lake", "sea", "lagoon", "loch", "loough")):
        return "Lake " + name
    return name


def perpendicular_distance(point, start, end):
    # The builder simplifies only small coordinate runs. Equirectangular scaling
    # makes the tolerance reasonably consistent away from the poles.
    scale = math.cos(math.radians((point[1] + start[1] + end[1]) / 3))
    px, py = point[0] * scale, point[1]
    ax, ay = start[0] * scale, start[1]
    bx, by = end[0] * scale, end[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    return abs(dy * px - dx * py + bx * ay - by * ax) / math.hypot(dx, dy)


def simplify_open(points):
    if len(points) < 3:
        return points
    if len(points) < 3:
        return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        distance, index = max(
            ((perpendicular_distance(points[i], points[first], points[last]), i) for i in range(first + 1, last)),
            default=(0, None),
        )
        if index is not None and distance > TOLERANCE:
            keep.add(index)
            stack.extend(((first, index), (index, last)))
    return [points[i] for i in sorted(keep)]


def simplify(points):
    if len(points) < 3:
        return points
    if points[0] != points[-1]:
        return simplify_open(points)
    # A closed ring cannot use its identical start/end as a DP baseline. Split
    # it at the opposite point, simplify both arcs, then re-close it.
    work = points[:-1]
    if len(work) < 3:
        return points
    midpoint = len(work) // 2
    first = simplify_open(work[:midpoint + 1])
    second = simplify_open(work[midpoint:] + [work[0]])
    return first[:-1] + second


def clean_coordinates(coordinates):
    return [[round(point[0], 3), round(point[1], 3)] for point in simplify(coordinates)]


def compact_geometry(geometry):
    kind = geometry["type"]
    coordinates = geometry["coordinates"]
    if kind == "Polygon":
        return "P", [clean_coordinates(ring) for ring in coordinates]
    if kind == "MultiPolygon":
        return "P", [[clean_coordinates(ring) for ring in polygon] for polygon in coordinates]
    if kind == "LineString":
        return "L", [clean_coordinates(coordinates)]
    if kind == "MultiLineString":
        return "L", [clean_coordinates(line) for line in coordinates]
    raise ValueError("unsupported geometry: " + kind)


def bounds(coordinates):
    points = []
    def visit(value):
        if isinstance(value[0], (int, float)):
            points.append(value)
        else:
            for child in value:
                visit(child)
    visit(coordinates)
    return [round(min(p[0] for p in points), 3), round(min(p[1] for p in points), 3), round(max(p[0] for p in points), 3), round(max(p[1] for p in points), 3)]


def include(source, properties):
    feature_class = properties.get("FEATURECLA") or properties.get("featurecla")
    if source == "regions":
        return REGION_CLASSES.get(feature_class)
    if source == "river":
        return "river" if feature_class == "River" else None
    # Reservoirs are man-made. Keep lakes including alkaline lakes.
    return "lake" if feature_class in {"Lake", "Alkaline Lake"} and not properties.get("dam_name") else None


def main():
    features = []
    for filename, source in SOURCES:
        for feature in get_source(filename)["features"]:
            properties = feature["properties"]
            feature_type = include(source, properties)
            name = name_of(properties)
            if not feature_type or not name or not feature.get("geometry"):
                continue
            shape, coordinates = compact_geometry(feature["geometry"])
            if not coordinates:
                continue
            features.append([display_name(name, source), feature_type, shape, bounds(coordinates), coordinates])
    payload = {"version": 1, "source": "Natural Earth 10m physical, " + COMMIT, "features": features}
    target = Path(__file__).resolve().parents[1] / "data" / "geography.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote %s features, %.1f KiB" % (len(features), target.stat().st_size / 1024))


if __name__ == "__main__":
    main()
