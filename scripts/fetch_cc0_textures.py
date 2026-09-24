#!/usr/bin/env python3
"""Fetch real CC0 surface textures from Poly Haven and bake them into the same
albedo+normal pairs scripts/bake_textures.py produces, so they drop into
src/game/surfaces.ts unchanged (same file names, sizes and quality settings).

Needs outbound network access to api.polyhaven.com / dl.polyhaven.org. Run it
on a machine that has that, then commit the result (public/tex/*.webp,
src/game/texture-manifest.json, public/tex/SOURCES.md).

Each surface is auto-matched to a Poly Haven asset by tag keywords (KEYWORDS
below) against their catalog, which changes over time. Check the pick, or run
--list-candidates to see the scored alternatives and pin a better one in
OVERRIDE_SLUG.

    pip install numpy pillow
    python3 scripts/fetch_cc0_textures.py                    # all 7 surfaces
    python3 scripts/fetch_cc0_textures.py --only roof,rock   # just these
    python3 scripts/fetch_cc0_textures.py --list-candidates roof
"""
import argparse
import json
import os
import time
import urllib.request
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

def _find_repo_root(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isfile(os.path.join(d, 'src', 'game', 'texture-manifest.json')):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    return None


_ROOT = _find_repo_root(os.path.dirname(os.path.abspath(__file__))) or _find_repo_root(os.getcwd())
if _ROOT is None:
    raise SystemExit(
        "could not find src/game/texture-manifest.json above this script or the current directory.\n"
        "Run this from inside your ninja checkout (e.g. as scripts/fetch_cc0_textures.py there), "
        "or cd into the repo root first."
    )

API = 'https://api.polyhaven.com'
OUT = os.path.join(_ROOT, 'public', 'tex')
MANIFEST = os.path.join(_ROOT, 'src', 'game', 'texture-manifest.json')
SOURCES_JSON = os.path.join(_ROOT, 'scripts', 'cc0_sources.json')
N = 1024
RES_ORDER = ('1k', '2k', '4k')
FMT_ORDER = ('jpg', 'png')
ALBEDO_KEYS = ('Diffuse', 'diff', 'Color')
NORMAL_GL_KEYS = ('nor_gl', 'NormalGL')
NORMAL_DX_KEYS = ('nor_dx', 'NormalDX')

# keyword -> substring match against each candidate's name/tags/categories
KEYWORDS = {
    'cobble': ['cobblestone', 'cobble', 'sett'],
    'flag': ['paving', 'flagstone', 'pavement', 'slabs'],
    'ground': ['forest floor', 'forest ground', 'leaves', 'mud', 'soil', 'dirt'],
    'rock': ['rock', 'granite', 'cliff'],
    'wood': ['wood planks', 'planks', 'wood floor', 'timber'],
    'bark': ['bark'],
    'roof': ['roof tiles', 'roof', 'terracotta', 'clay tiles'],
}
# fill in a slug (from --list-candidates) to skip the automatic search for that surface
OVERRIDE_SLUG = {
    # 'roof': 'roof_tiles_03',
}

_INDEX = None


# ---------------------------------------------------------------------------
# network
# ---------------------------------------------------------------------------
def fetch(url, retries=3, backoff=1.0):
    req = urllib.request.Request(url, headers={'User-Agent': 'ninja-cc0-texture-fetch/1.0'})
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(backoff * (2 ** attempt))
    raise RuntimeError(f'{url}: {last_err}')


def fetch_json(url):
    return json.loads(fetch(url))


def asset_index():
    global _INDEX
    if _INDEX is None:
        _INDEX = fetch_json(f'{API}/assets?type=textures')
    return _INDEX


def score(meta, keywords):
    text = ' '.join([meta.get('name', ''), *meta.get('tags', []), *meta.get('categories', [])]).lower()
    return sum(1 for kw in keywords if kw in text)


def best_match(keywords):
    scored = [(score(meta, keywords), slug) for slug, meta in asset_index().items()]
    scored = [s for s in scored if s[0] > 0]
    if not scored:
        return None
    scored.sort(key=lambda t: (-t[0], t[1]))
    return scored[0][1]


def list_candidates(name):
    scored = [(score(meta, KEYWORDS[name]), slug, meta.get('name', '')) for slug, meta in asset_index().items()]
    scored = sorted((s for s in scored if s[0] > 0), key=lambda t: (-t[0], t[1]))[:10]
    for sc, slug, disp in scored:
        print(f'{sc}  {slug}  ({disp})')


def pick_map(files, keys, res_order=RES_ORDER, fmt_order=FMT_ORDER):
    for k in keys:
        node = files.get(k)
        if not node:
            continue
        for res in res_order:
            variants = node.get(res)
            if not variants:
                continue
            for fmt in fmt_order:
                entry = variants.get(fmt)
                if entry and 'url' in entry:
                    return entry['url']
    return None


def pick_normal(files):
    url = pick_map(files, NORMAL_GL_KEYS)
    if url:
        return url, False
    url = pick_map(files, NORMAL_DX_KEYS)
    return (url, True) if url else (None, False)


# ---------------------------------------------------------------------------
# image processing (mirrors bake_textures.py's save())
# ---------------------------------------------------------------------------
def to_square(img):
    w, h = img.size
    if w == h:
        return img
    s = min(w, h)
    l, t = (w - s) // 2, (h - s) // 2
    return img.crop((l, t, l + s, t + s))


def dx_to_gl(img):
    r, g, b = img.split()
    return Image.merge('RGB', (r, ImageOps.invert(g), b))


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mean_luminance(albedo):
    a8 = np.array(albedo, dtype=np.uint8)
    lin = srgb_to_lin(a8.astype(np.float32))
    return float((lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722).mean())


def _save_webp(img, path, quality):
    tmp = path + '.tmp'
    img.save(tmp, format='WEBP', quality=quality, method=6)
    os.replace(tmp, path)


def save_pair(name, albedo, normal):
    lum = mean_luminance(albedo)
    for size, suffix in ((N, ''), (N // 2, '_s')):
        ai, ni = (albedo, normal) if size == N else (albedo.resize((size, size), Image.LANCZOS), normal.resize((size, size), Image.LANCZOS))
        _save_webp(ai, os.path.join(OUT, f'{name}_a{suffix}.webp'), 84)
        _save_webp(ni, os.path.join(OUT, f'{name}_n{suffix}.webp'), 90)
    return lum


def process_surface(name):
    slug = OVERRIDE_SLUG.get(name) or best_match(KEYWORDS[name])
    if not slug:
        raise RuntimeError(f'no Poly Haven match (tune KEYWORDS["{name}"] or set OVERRIDE_SLUG)')
    files = fetch_json(f'{API}/files/{slug}')
    albedo_url = pick_map(files, ALBEDO_KEYS)
    normal_url, is_dx = pick_normal(files)
    if not albedo_url or not normal_url:
        raise RuntimeError(f'"{slug}" is missing an albedo or normal map')
    albedo = to_square(Image.open(BytesIO(fetch(albedo_url))).convert('RGB')).resize((N, N), Image.LANCZOS)
    normal = to_square(Image.open(BytesIO(fetch(normal_url))).convert('RGB')).resize((N, N), Image.LANCZOS)
    if is_dx:
        normal = dx_to_gl(normal)
    lum = save_pair(name, albedo, normal)
    return slug, lum


# ---------------------------------------------------------------------------
# bookkeeping
# ---------------------------------------------------------------------------
def load_sources():
    if os.path.exists(SOURCES_JSON):
        with open(SOURCES_JSON) as f:
            return json.load(f)
    return {}


def write_sources(sources):
    with open(SOURCES_JSON, 'w') as f:
        json.dump(sources, f, indent=2)
        f.write('\n')
    with open(os.path.join(OUT, 'SOURCES.md'), 'w') as f:
        f.write('| surface | polyhaven asset | license |\n|---|---|---|\n')
        for name in sorted(sources):
            f.write(f'| {name} | [{sources[name]}](https://polyhaven.com/a/{sources[name]}) | CC0 1.0 |\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', help='comma-separated surface names to (re)fetch, default: all')
    ap.add_argument('--list-candidates', metavar='SURFACE', help='print top Poly Haven matches for a surface and exit')
    args = ap.parse_args()

    if args.list_candidates:
        list_candidates(args.list_candidates)
        return

    names = args.only.split(',') if args.only else list(KEYWORDS)
    os.makedirs(OUT, exist_ok=True)
    with open(MANIFEST) as f:
        manifest = json.load(f)
    sources = load_sources()
    failures = []

    for name in names:
        print(f'{name}: ', end='', flush=True)
        try:
            slug, lum = process_surface(name)
            manifest[name] = round(lum, 4)
            sources[name] = slug
            print(f'ok ({slug}, lum={lum:.4f})')
        except Exception as e:
            failures.append((name, str(e)))
            print(f'FAILED: {e}')

    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    write_sources(sources)

    if failures:
        print('\nfailed (public/tex left unchanged for these):')
        for name, err in failures:
            print(f'  {name}: {err}')
        raise SystemExit(1)
    print('\ndone')


if __name__ == '__main__':
    main()
