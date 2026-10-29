"""
Every Practice Portal logo asset from one source image: the mark on a plain
dark background.

    python3 brand/make_logos.py path/to/logo.png [noise=12] [solid=150]

Writes brand/ (original, transparent, circle, icon-circle, icon-transparent),
public/ (favicon.ico, favicon-192.png, apple-touch-icon.png) and the header
logos in src/assets/ (header, and the home page's larger copy). `noise` is how far from the background colour still
counts as background (the source's faint texture); `solid` is how far
counts as certainly the mark. Needs Pillow, numpy and scipy.
"""
import os
import sys
from PIL import Image, ImageDraw
import numpy as np

SRC = sys.argv[1]
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 12
T1 = float(sys.argv[3]) if len(sys.argv) > 3 else 150
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B, P = f'{REPO}/brand', f'{REPO}/public'

rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(float)
border = np.concatenate([rgb[:80].reshape(-1, 3), rgb[-80:].reshape(-1, 3), rgb[:, :80].reshape(-1, 3), rgb[:, -80:].reshape(-1, 3)])
bg = np.median(border, axis=0)
d = np.linalg.norm(rgb - bg, axis=2)
# Local matte: every pixel takes the colour of the nearest pixel well inside
# the mark, and its opacity is how far it has moved from the background
# towards that colour. A single distance cut-off can't do this — the mark's
# colours sit at different distances, so its edges came out as dark rims.
from scipy.ndimage import binary_erosion, distance_transform_edt
interior = binary_erosion(d >= T1, iterations=3)
_, (iy, ix) = distance_transform_edt(~interior, return_indices=True)
fg = rgb[iy, ix]
v = fg - bg
a = np.clip(((rgb - bg) * v).sum(axis=2) / np.maximum((v * v).sum(axis=2), 1), 0, 1)
a[d < T0] = 0          # the background's faint texture
col = fg
col[a == 0] = 0
full = Image.fromarray(np.dstack([col, a * 255]).astype(np.uint8))
ys, xs = np.where(a > 0.02)
mark = full.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
mw, mh = mark.size
BG = tuple(int(round(c)) for c in bg)

def square(pad):
    side = int(max(mw, mh) * pad)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.alpha_composite(mark, ((side - mw) // 2, (side - mh) // 2))
    return sq.resize((1024, 1024), Image.LANCZOS)

am = np.asarray(mark)[..., 3] > 128
yy, xx = np.where(am)
R = np.sqrt((xx - mw / 2) ** 2 + (yy - mh / 2) ** 2).max()

def circle(k):
    n, S = int(2 * R * k), 4
    disc = Image.new('L', (n * S, n * S), 0)
    ImageDraw.Draw(disc).ellipse((0, 0, n * S - 1, n * S - 1), fill=255)
    c = Image.new('RGBA', (n, n), BG + (0,))
    c.putalpha(disc.resize((n, n), Image.LANCZOS))
    c.alpha_composite(mark, (int(n / 2 - mw / 2), int(n / 2 - mh / 2)))
    return c.resize((1024, 1024), Image.LANCZOS)

Image.open(SRC).save(f'{B}/logo-original.png', optimize=True)
square(1.08).save(f'{B}/logo-transparent.png', optimize=True)
circle(1.14).save(f'{B}/logo-circle.png', optimize=True)
circle(1.04).save(f'{B}/icon-circle.png', optimize=True)
icon = square(1.02)
icon.save(f'{B}/icon-transparent.png', optimize=True)
icon.save(f'{P}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
icon.resize((192, 192), Image.LANCZOS).save(f'{P}/favicon-192.png', optimize=True)
sq = Image.new('RGBA', (1024, 1024), BG + (255,))
s = 1024 * 0.66 / max(mw, mh)
m = mark.resize((round(mw * s), round(mh * s)), Image.LANCZOS)
sq.alpha_composite(m, ((1024 - m.width) // 2, (1024 - m.height) // 2))
sq.convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{P}/apple-touch-icon.png', optimize=True)
h = 160
mark.resize((round(mw * h / mh), h), Image.LANCZOS).save(f'{REPO}/src/assets/practice-portal-logo.png', optimize=True)
# The home page's wordmark shows it up to ~180 px tall; this is sharp at 2x.
mark.resize((round(mw * 360 / mh), 360), Image.LANCZOS).save(f'{REPO}/src/assets/practice-portal-mark-large.png', optimize=True)
print('bg', BG, 'mark', mark.size, 'header', round(mw * h / mh), 'x', h)
