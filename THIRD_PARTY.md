# Third-party data

## Natural Earth physical geography

`data/geography.json` is a simplified derivative of Natural Earth 10m physical
vector data. It is built from `ne_10m_geography_regions_polys`,
`ne_10m_rivers_lake_centerlines`, and `ne_10m_lakes` at commit
[`ca96624a56bd078437bca8184e78163e5039ad19`](https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19).
Natural Earth data is public domain; see its [terms of use](https://www.naturalearthdata.com/about/terms-of-use/).

The reproducible standard-library builder is `scripts/build-geography.py`.
