"""Fabrique les versions détourées (fond transparent) des rendus de voitures.

    python3 outils/detourer.py            -> assets/detoure/voiture-….webp pour chaque assets/voiture-….jpg

Le cadre « Résultats » les utilise pour que les initiales et le numéro restent visibles
tout autour de la voiture. Relancer après chaque nouvelle voiture (Pillow, numpy, scipy).
"""
import glob
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def detourer(chemin):
    a = np.asarray(Image.open(chemin).convert('RGB')).astype(float)
    H, W, _ = a.shape
    # fond : dégradé estimé ligne par ligne à partir des bords gauche et droit
    L = np.median(a[:, :24], axis=1); R = np.median(a[:, -24:], axis=1)
    t = np.linspace(0, 1, W)[None, :, None]
    bg = L[:, None, :] * (1 - t) + R[:, None, :] * t
    diff = np.abs(a - bg).max(2)
    # ligne du sol : fin de la carrosserie, avant le reflet
    cnt = (diff > 25).sum(1); top = int(np.argmax(cnt > 100)); y = top + 20
    while y < H - 1 and cnt[y] >= 30:
        y += 1
    sol = y
    m = diff > 16
    m[sol + 2:] = False
    m = nd.binary_closing(m, structure=np.ones((9, 9)), iterations=2)
    m = nd.binary_fill_holes(m)
    lab, n = nd.label(m)
    if n > 1:
        m = lab == (np.argmax(nd.sum(m, lab, range(1, n + 1))) + 1)
        m = nd.binary_fill_holes(m)
    corps = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255
    reflet = np.clip((diff - 8) / 40, 0, 1)
    fondu = np.clip(1 - (np.arange(H) - sol) / 70, 0, 1)[:, None]; fondu[:sol] = 0
    al = np.maximum(corps, reflet * fondu * 0.45)
    A = al[..., None]
    fg = np.where(A > 0.05, (a - bg * (1 - A)) / np.maximum(A, 1e-3), a)
    fg = np.where(corps[..., None] > 0.5, a, fg)
    return Image.fromarray(np.dstack([np.clip(fg, 0, 255), al * 255]).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    os.makedirs(os.path.join(RACINE, 'assets', 'detoure'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(RACINE, 'assets', 'voiture-*.jpg'))):
        o = os.path.join(RACINE, 'assets', 'detoure', os.path.basename(f)[:-4] + '.webp')
        detourer(f).save(o, 'WEBP', quality=86, method=6)
        print('détourée :', os.path.basename(o))
