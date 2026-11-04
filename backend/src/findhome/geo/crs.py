"""WGS84 <-> SWEREF 99 TM transforms (always lon/lat order)."""
from __future__ import annotations

from functools import lru_cache

import shapely
from pyproj import Transformer
from shapely.geometry.base import BaseGeometry

WGS84, SWEREF = "EPSG:4326", "EPSG:3006"


@lru_cache(maxsize=8)
def _tf(src: str, dst: str) -> Transformer:
    return Transformer.from_crs(src, dst, always_xy=True)


def to_metric(geom: BaseGeometry, src: str = WGS84) -> BaseGeometry:
    return shapely.transform(geom, _tf(src, SWEREF).transform, interleaved=False)


def to_wgs84(geom: BaseGeometry, src: str = SWEREF) -> BaseGeometry:
    return shapely.transform(geom, _tf(src, WGS84).transform, interleaved=False)


def point_metric(lon: float, lat: float) -> tuple[float, float]:
    return _tf(WGS84, SWEREF).transform(lon, lat)


def points_metric(lons: list[float], lats: list[float]) -> tuple[list[float], list[float]]:
    """Many lon/lat pairs at once (faster than one call per point)."""
    xs, ys = _tf(WGS84, SWEREF).transform(lons, lats)
    return list(xs), list(ys)


def points_wgs84(xs: list[float], ys: list[float]) -> list[list[float]]:
    """Many EPSG:3006 points to [lon, lat] (6 decimals, about 0.1 m)."""
    lons, lats = _tf(SWEREF, WGS84).transform(xs, ys)
    return [[round(lo, 6), round(la, 6)] for lo, la in zip(lons, lats, strict=True)]
