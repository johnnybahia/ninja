#!/usr/bin/env python3
"""Bake the game's surface textures (albedo + normal maps) procedurally.

Everything is generated from noise in this file, so the output carries no third-party
licence. Tileable by construction: spectral noise comes from an inverse FFT and the
Voronoi lattice wraps around the edges.

    pip install numpy pillow
    python3 scripts/bake_textures.py        # writes public/tex/*.webp + manifest.json
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex')
N = 1024
rng = np.random.default_rng(7)


# ---------------------------------------------------------------------------
# noise helpers (all tileable)
# ---------------------------------------------------------------------------
def spectral(n, beta, seed, aniso=(1.0, 1.0)):
    """fBm-like noise with power spectrum 1/f^beta, normalised to 0..1."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((n, n))
    f = np.fft.fft2(white)
    ky = np.fft.fftfreq(n)[:, None] * aniso[1]
    kx = np.fft.fftfreq(n)[None, :] * aniso[0]
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1.0
    f *= 1.0 / k ** beta
    f[0, 0] = 0
    out = np.real(np.fft.ifft2(f))
    out -= out.min()
    return out / out.max()


def voronoi(n, cells, seed, jitter=0.85):
    """Tileable Voronoi: returns F1, F2 (in cell units) and nearest cell id."""
    r = np.random.default_rng(seed)
    jx = 0.5 + (r.random((cells, cells)) - 0.5) * jitter
    jy = 0.5 + (r.random((cells, cells)) - 0.5) * jitter
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) * (cells / n)
    ix = np.floor(xs).astype(int)
    iy = np.floor(ys).astype(int)
    f1 = np.full((n, n), 9.0, np.float32)
    f2 = np.full((n, n), 9.0, np.float32)
    cid = np.zeros((n, n), int)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx = (ix + dx) % cells
            cy = (iy + dy) % cells
            px = ix + dx + jx[cy, cx]
            py = iy + dy + jy[cy, cx]
            d = np.hypot(px - xs, py - ys)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, cy * cells + cx, cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def normal_map(h, strength):
    """Height (0..1) -> OpenGL-convention normal map (uint8 RGB)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    return (rgb * 255 + 0.5).astype(np.uint8)


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def ramp(t, stops):
    """Map 0..1 through colour stops [(pos, (r,g,b)), ...] -> float RGB 0..255."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(p1 - p0, 1e-6))[..., None]
        seg = np.array(c0, np.float32) * (1 - k) + np.array(c1, np.float32) * k
        out = np.where(m[..., None], seg, out)
    return out


manifest = {}


def save(name, albedo, height, strength, note):
    """Write albedo/normal at 1024 and 512 and record the albedo's mean linear luminance."""
    a8 = np.clip(albedo, 0, 255).astype(np.uint8)
    n8 = normal_map(height, strength)
    lin = srgb_to_lin(a8.astype(np.float32))
    lum = float((lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722).mean())
    for size, suffix in ((1024, ''), (512, '_s')):
        ai = Image.fromarray(a8)
        ni = Image.fromarray(n8)
        if size != a8.shape[0]:
            ai = ai.resize((size, size), Image.LANCZOS)
            ni = ni.resize((size, size), Image.LANCZOS)
        ai.save(os.path.join(OUT, f'{name}_a{suffix}.webp'), quality=84, method=6)
        ni.save(os.path.join(OUT, f'{name}_n{suffix}.webp'), quality=90, method=6)
    manifest[name] = {'lum': round(lum, 4), 'note': note}
    print(f'{name}: mean linear luminance {lum:.3f}')


# ---------------------------------------------------------------------------
# surfaces
# ---------------------------------------------------------------------------
def cobble():
    cells = 13
    f1, f2, cid = voronoi(N, cells, 11, 0.9)
    edge = f2 - f1
    fine = spectral(N, 1.6, 12)
    mid = spectral(N, 2.2, 13)
    # rounded river stones: height rises quickly off the joint, then domes gently
    dome = np.sqrt(smooth(0.0, 0.5, edge)) * (1 - 0.35 * smooth(0.0, 0.6, f1))
    gap = smooth(0.02, 0.07, edge)
    tilt = (np.random.default_rng(14).random(cells * cells)[cid] - 0.5) * 0.15
    h = dome * (0.8 + tilt) * gap + fine * 0.07 + mid * 0.05
    tone = np.random.default_rng(15).random(cells * cells)[cid]
    base = ramp(tone * 0.7 + mid * 0.3, [(0, (88, 84, 80)), (0.5, (124, 117, 108)), (1, (156, 147, 132))])
    warm = np.random.default_rng(16).random(cells * cells)[cid][..., None]
    base = base * (0.94 + warm * np.array([0.1, 0.05, -0.02]))
    base *= (0.82 + 0.3 * fine)[..., None]
    base *= (0.72 + 0.28 * smooth(0.02, 0.3, edge))[..., None]  # soft cavity toward the joint
    moss = smooth(0.55, 0.75, spectral(N, 2.0, 17)) * (1 - gap)
    grout = np.array((84, 78, 68), np.float32) * (0.8 + 0.4 * fine[..., None])
    mortar = grout * (1 - moss[..., None]) + np.array((66, 86, 42), np.float32) * moss[..., None]
    alb = base * gap[..., None] + mortar * (1 - gap[..., None])
    save('cobble', alb, h, 9.0, 'plaza: rounded river cobbles with moss in the joints')


def flag():
    f1, f2, cid = voronoi(N, 4, 21, 0.75)
    edge = f2 - f1
    fine = spectral(N, 1.5, 22)
    mid = spectral(N, 2.3, 23)
    gap = smooth(0.015, 0.05, edge)
    bevel = smooth(0.0, 0.12, edge)
    h = (0.55 + 0.35 * bevel) * gap + fine * 0.05 + mid * 0.1
    tone = np.random.default_rng(24).random(16)[cid]
    base = ramp(tone * 0.6 + mid * 0.4, [(0, (96, 92, 86)), (0.6, (128, 122, 112)), (1, (152, 146, 132))])
    base *= (0.82 + 0.3 * fine)[..., None]
    base *= (0.7 + 0.3 * bevel)[..., None]
    alb = base * gap[..., None] + np.array((46, 44, 40), np.float32) * (1 - gap[..., None])
    save('flag', alb, h, 9.0, 'approach path: large worn flagstones')


def ground():
    macro = spectral(N, 2.4, 31)
    mid = spectral(N, 1.9, 32)
    fine = spectral(N, 1.2, 33)
    f1, f2, cid = voronoi(N, 40, 34, 1.0)
    psize = np.random.default_rng(36).random(1600)[cid]
    pebble = smooth(0.12 + psize * 0.2, 0.04 + psize * 0.1, f1) * (np.random.default_rng(35).random(1600)[cid] > 0.82)
    h = mid * 0.5 + fine * 0.25 + pebble * 0.4
    soil = ramp(mid * 0.7 + fine * 0.3, [(0, (58, 48, 36)), (0.5, (86, 72, 52)), (1, (112, 96, 70))])
    moss = ramp(fine, [(0, (52, 66, 34)), (1, (98, 112, 58))])
    m = smooth(0.35, 0.65, macro)[..., None]
    alb = soil * (1 - m) + moss * m
    alb = alb * (1 - pebble[..., None]) + np.array((104, 98, 90), np.float32) * (0.6 + 0.6 * psize[..., None]) * (0.8 + 0.4 * fine[..., None]) * pebble[..., None]
    save('ground', alb, h, 6.0, 'soil and moss with small pebbles')


def rock():
    warp = spectral(N, 2.2, 41)
    big = spectral(N, 2.0, 42)
    fine = spectral(N, 1.4, 43)
    ys = np.mgrid[0:N, 0:N][0] / N
    strata = 0.5 + 0.5 * np.sin((ys * 7 + warp * 1.6) * 2 * math.pi)
    ridged = 1 - np.abs(spectral(N, 1.8, 44) * 2 - 1)
    cracks = smooth(0.965, 0.995, ridged)
    midr = spectral(N, 1.7, 48)
    cracks = cracks * smooth(0.3, 0.6, big)
    h = big * 0.45 + midr * 0.25 + strata * 0.1 + fine * 0.15 - cracks * 0.18
    base = ramp(big * 0.4 + midr * 0.35 + fine * 0.25, [(0, (66, 64, 62)), (0.45, (108, 104, 98)), (1, (156, 150, 140))])
    base *= (0.9 + 0.12 * strata)[..., None]
    base *= (1 - 0.35 * cracks)[..., None]
    f1, _, cid = voronoi(N, 28, 45, 1.0)
    lichen = smooth(0.34, 0.18, f1) * (np.random.default_rng(46).random(784)[cid] > 0.88) * smooth(0.5, 0.65, big) * 0.6
    alb = base * (1 - 0.85 * lichen[..., None]) + np.array((150, 150, 96), np.float32) * 0.85 * lichen[..., None]
    moss = smooth(0.62, 0.8, spectral(N, 2.1, 47))[..., None]
    alb = alb * (1 - 0.7 * moss) + np.array((66, 84, 44), np.float32) * 0.7 * moss
    save('rock', alb, h, 14.0, 'granite with strata, cracks, lichen and moss')


def wood():
    grain = spectral(N, 1.7, 51, aniso=(1.0, 14.0))
    warp = spectral(N, 2.4, 52, aniso=(1.0, 6.0))
    xs = np.mgrid[0:N, 0:N][1] / N
    rings = 0.5 + 0.5 * np.sin((xs * 22 + warp * 3.0) * 2 * math.pi)
    seam = smooth(0.0, 0.012, np.abs(((xs * 4) % 1) - 0.5) * 2 - 0.985)  # 4 planks
    seam = 1 - smooth(0.0, 1.0, 1 - np.abs((xs * 4 % 1) - 0.5) * 2 * 60).clip(0, 1)
    plank = np.floor(xs * 4).astype(int)
    tone = np.random.default_rng(53).random(4)[plank]
    h = grain * 0.5 + rings * 0.18 - (1 - seam) * 0.5
    base = ramp(grain * 0.55 + rings * 0.45, [(0, (84, 52, 34)), (0.5, (120, 80, 52)), (1, (150, 108, 72))])
    base *= (0.85 + 0.3 * tone)[..., None]
    base *= (0.35 + 0.65 * seam)[..., None]
    save('wood', base, h, 5.0, 'hinoki-like planks, grain along v')


def bark():
    fib = spectral(N, 1.1, 61, aniso=(1.0, 12.0))
    ridg = 1 - np.abs(spectral(N, 1.45, 62, aniso=(1.0, 6.0)) * 2 - 1)
    fine = spectral(N, 1.0, 63)
    furrow = smooth(0.5, 0.9, ridg)
    h = furrow * 0.55 + fib * 0.3 + fine * 0.15
    base = ramp(furrow * 0.6 + fib * 0.4, [(0, (34, 26, 22)), (0.5, (70, 56, 46)), (1, (118, 102, 88))])
    moss = smooth(0.6, 0.78, spectral(N, 2.2, 64, aniso=(1.0, 2.0)))[..., None] * (1 - furrow[..., None] * 0.5)
    alb = base * (1 - 0.6 * moss) + np.array((72, 92, 48), np.float32) * 0.6 * moss
    save('bark', alb, h, 16.0, 'deeply furrowed bark with moss, fibres along v')


def roof():
    ys, xs = np.mgrid[0:N, 0:N] / N
    cols, rows = 16, 14
    # hongawara: alternating round cover tiles and concave pan tiles run up the slope (v);
    # each course overlaps the one below it, leaving a soft shadowed lip
    u = (xs * cols) % 1
    v = (ys * rows) % 1
    col = np.floor(xs * cols).astype(int)
    row = np.floor(ys * rows).astype(int)
    convex = (col % 2 == 0)
    prof = np.where(convex, np.sqrt(np.clip(np.sin(u * math.pi), 0, 1)) * 0.9 + 0.1, 0.25 * (1 - np.sin(u * math.pi)))
    lip = smooth(0.0, 0.12, v) * 0.25 + 0.75
    h = prof * 0.75 + lip * 0.15 + spectral(N, 1.3, 71) * 0.04
    grime = spectral(N, 2.0, 73)
    tone = np.random.default_rng(72).random(cols * rows)[row * cols + col] * 0.15
    base = ramp(grime * 0.7 + tone + 0.1, [(0, (46, 48, 56)), (1, (96, 98, 108))])
    shade = np.where(convex, 0.7 + 0.45 * prof, 0.62 + 0.2 * prof)
    base *= shade[..., None] * lip[..., None]
    streak = smooth(0.62, 0.9, spectral(N, 1.8, 74, aniso=(1.0, 0.15)))[..., None]
    alb = base * (1 - 0.3 * streak) + np.array((68, 74, 50), np.float32) * 0.3 * streak
    save('roof', alb, h, 8.0, 'kawara tiles: columns along u, courses up v')


def water():
    ys, xs = np.mgrid[0:N // 2, 0:N // 2] / (N // 2)
    h = np.zeros_like(xs)
    r = np.random.default_rng(81)
    for i in range(40):
        kx, ky = r.integers(-9, 10), r.integers(-9, 10)
        if kx == 0 and ky == 0:
            continue
        k = math.hypot(kx, ky)
        h += np.sin((kx * xs + ky * ys) * 2 * math.pi + r.random() * 6.28) * k ** -1.3
    h = (h - h.min()) / (h.max() - h.min())
    n8 = normal_map(h, 7.0)
    Image.fromarray(n8).save(os.path.join(OUT, 'water_n.webp'), quality=90, method=6)


# ---------------------------------------------------------------------------
# foliage cards (RGBA, colour bled into transparent texels to avoid dark fringes)
# ---------------------------------------------------------------------------
def bleed(img):
    a = np.array(img).astype(np.float32)
    alpha = a[..., 3:4] / 255
    mean = (a[..., :3] * alpha).sum((0, 1)) / max(alpha.sum(), 1)
    a[..., :3] = a[..., :3] * alpha + mean * (1 - alpha)
    return Image.fromarray(a.astype(np.uint8))


def sakura_card():
    S = 512
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(91)
    # twigs
    for _ in range(7):
        x0, y0 = S / 2 + r.normal(0, 30), S * 0.62 + r.normal(0, 20)
        a = r.uniform(0, 2 * math.pi)
        d.line([(x0, y0), (x0 + math.cos(a) * 170, y0 + math.sin(a) * 150)], fill=(62, 40, 34, 255), width=4)
    # blossoms: five rounded petals, several pinks, denser toward the centre
    for _ in range(230):
        rad = abs(r.normal(0, 0.23)) * S
        ang = r.uniform(0, 2 * math.pi)
        cx, cy = S / 2 + math.cos(ang) * rad, S / 2 + math.sin(ang) * rad * 0.85
        if not (18 < cx < S - 18 and 18 < cy < S - 18):
            continue
        size = r.uniform(9, 16)
        t = r.random()
        col = (int(250 - 24 * t), int(196 - 70 * t), int(212 - 46 * t), 255)
        rot = r.uniform(0, 2 * math.pi)
        for p in range(5):
            pa = rot + p * 2 * math.pi / 5
            px, py = cx + math.cos(pa) * size * 0.55, cy + math.sin(pa) * size * 0.55
            d.ellipse([px - size * 0.5, py - size * 0.5, px + size * 0.5, py + size * 0.5], fill=col)
        d.ellipse([cx - 2.5, cy - 2.5, cx + 2.5, cy + 2.5], fill=(200, 80, 110, 255))
    img = img.filter(ImageFilter.SMOOTH)
    bleed(img).save(os.path.join(OUT, 'sakura_card.webp'), quality=90, method=6)


def pine_card():
    S = 512
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(92)
    # a spray: central twig with needle bundles radiating along it
    for b in range(13):
        a0 = -math.pi / 2 + r.normal(0, 0.5)
        x0, y0 = S / 2 + r.normal(0, 40), S * 0.8 + r.normal(0, 30)
        L = r.uniform(220, 320)
        x1, y1 = x0 + math.cos(a0) * L, y0 + math.sin(a0) * L
        d.line([(x0, y0), (x1, y1)], fill=(58, 44, 30, 255), width=4)
        for k in range(34):
            t = k / 26
            bx, by = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            for side in (-1, 1):
                na = a0 + side * r.uniform(0.5, 1.1)
                nl = r.uniform(26, 46) * (1 - t * 0.4)
                g = int(r.uniform(70, 120))
                d.line([(bx, by), (bx + math.cos(na) * nl, by + math.sin(na) * nl)], fill=(int(g * 0.35), g, int(g * 0.45), 255), width=3)
    bleed(img).save(os.path.join(OUT, 'pine_card.webp'), quality=90, method=6)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    cobble()
    flag()
    ground()
    rock()
    wood()
    bark()
    roof()
    water()
    sakura_card()
    pine_card()
    src = os.path.join(os.path.dirname(__file__), '..', 'src', 'game', 'texture-manifest.json')
    with open(src, 'w') as f:
        json.dump({k: v['lum'] for k, v in manifest.items()}, f, indent=2)
        f.write('\n')
    print('done')
