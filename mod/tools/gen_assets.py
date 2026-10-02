import base64, io, json, os, sys
from PIL import Image
# Rebuilds hooks/assets.ts from the pictures in assets-src/.
#   python3 tools/gen_assets.py            (needs Pillow: pip install pillow)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets-src') + os.sep
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'hooks', 'assets.ts')

def uri(im, fmt, **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw)
    return 'data:image/%s;base64,%s' % (fmt.lower(), base64.b64encode(b.getvalue()).decode())

shell = Image.open(A + 'cassette-shell.png').convert('RGB').crop((84, 100, 1452, 922)).resize((800, 481), Image.LANCZOS)
hub = Image.open(A + 'cassette-hub.png').resize((152, 152), Image.LANCZOS)

# The cat is the traced vector (pixel-cat-faithful.svg), split at the tail so it
# can wag: a path wholly on one side goes to that side; one that straddles the
# split is drawn on both, clipped.
import re
SIZE, SPLIT = 1254, 916
svg = open(A + 'pixel-cat-faithful.svg').read()
# The front paws tap in turn: everything inside each box is drawn a second time
# in a group of its own, and cut out of the body, so a group can lift without
# leaving a copy behind. Left paw first, then right.
PAWS = [(330, 1045, 488, 1152), (488, 1045, 632, 1152)]
# The head sways: paths wholly above the neck move to the head group; one that
# crosses the neck is drawn in both, the head's copy clipped at the cut and the
# body's starting a little above it, so a tilted head never opens a gap.
HEAD_CUT, HEAD_OVERLAP, HEAD_PIVOT = 715, 40, (540, 730)
body, tail, both, head, paws = [], [], [], [], [[] for _ in PAWS]
for tag in re.findall(r'<path[^>]*/>', svg):
    d = re.search(r' d="([^"]*)"', tag).group(1)
    fill = re.search(r'fill="([^"]*)"', tag).group(1)
    move = re.search(r'translate\(([-\d.]+),([-\d.]+)\)', tag)
    tx, ty = (float(move.group(1)), float(move.group(2))) if move else (0.0, 0.0)
    points = re.findall(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', d)
    xs = [float(x) + tx for x, _ in points]; ys = [float(y) + ty for _, y in points]
    d = re.sub(r'\s*([MLCZ])\s*', r'\1', d).strip()
    out = '<path fill="%s" d="%s"%s/>' % (fill, d, ' transform="%s"' % move.group(0) if move else '')
    if min(xs) < SPLIT and min(ys) < HEAD_CUT: head.append(out)
    if max(xs) <= SPLIT:
        if max(ys) > HEAD_CUT: body.append(out)
    else:
        (tail if min(xs) >= SPLIT else both).append(out)
    for box, paw in zip(PAWS, paws):
        if min(xs) < box[2] and max(xs) > box[0] and min(ys) < box[3] and max(ys) > box[1]: paw.append(out)
print('cat paths', len(body), len(tail), len(both), 'head', len(head), 'paws', [len(p) for p in paws])
shared = ''.join(both)
hole = 'M0 %dH%dV%dH0Z' % (HEAD_CUT - HEAD_OVERLAP, SPLIT, SIZE) + ''.join('M%d %dH%dV%dH%dZ' % (b[0], b[1], b[2], b[3], b[0]) for b in PAWS)
body = ('<clipPath id="cl"><path clip-rule="evenodd" d="%s"/></clipPath><g clip-path="url(#cl)">%s%s</g>' % (hole, shared, ''.join(body)))
tail = ('<clipPath id="cr"><rect x="%d" width="%d" height="%d"/></clipPath><g clip-path="url(#cr)">%s</g>' % (SPLIT, SIZE - SPLIT, SIZE, shared)) + ''.join(tail)
head = '<clipPath id="ch"><rect width="%d" height="%d"/></clipPath><g clip-path="url(#ch)">%s</g>' % (SPLIT, HEAD_CUT, ''.join(head))
paw_clip = ''.join('<clipPath id="cp%d"><rect x="%d" y="%d" width="%d" height="%d"/></clipPath>' % (i, b[0], b[1], b[2] - b[0], b[3] - b[1]) for i, b in enumerate(PAWS))
G = SIZE

enamel = Image.open(A + 'olive-enamel.png').convert('RGB').crop((0, 0, 1254, 1163)).resize((420, 390), Image.LANCZOS)

# The transport keys, drawn as vector pictures a Markdown image-link can show.
def key(glyph, hot=False):
    top, low, ink = ('#d2693f', '#a94a2a', '#fff7e7') if hot else ('#bdb99a', '#8f8d70', '#23281b')
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="50" viewBox="0 0 112 50">'
           '<defs><linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>'
           '<rect x="1" y="3" width="110" height="46" rx="6" fill="#14170f"/>'
           '<rect x="1.5" y="1.5" width="109" height="43" rx="5.5" fill="url(#k)" stroke="#2b3122"/>'
           '<path d="M5 3.5h102" stroke="#fff" stroke-opacity=".45"/>'
           '<g fill="%s">%s</g></svg>') % (top, low, ink, glyph)
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()

KEYS = {
    'KEY_PREV': key('<path d="M55 15v16l-12-8zM69 15v16l-12-8z"/>'),
    'KEY_NEXT': key('<path d="M43 15v16l12-8zM57 15v16l12-8z"/>'),
    'KEY_PLAY': key('<path d="M50 14v18l15-9z"/>', True),
    'KEY_PAUSE': key('<path d="M48 15h6v16h-6zM58 15h6v16h-6z"/>', True),
}

# The band above the prompt shows the same cassette about 100 px wide.
shell_small = Image.open(A + 'cassette-shell.png').convert('RGB').crop((84, 100, 1452, 922)).resize((352, 212), Image.LANCZOS)
hub_small = Image.open(A + 'cassette-hub.png').resize((76, 76), Image.LANCZOS)

out = {
    'SHELL': uri(shell, 'WEBP', quality=70), 'HUB': uri(hub, 'WEBP', quality=82),
    'CAT_BODY': body, 'CAT_TAIL': tail, 'CAT_HEAD': head, 'CAT_PAW_LEFT': ''.join(paws[0]), 'CAT_PAW_RIGHT': ''.join(paws[1]), 'CAT_PAW_CLIP': paw_clip, 'SHELL_SMALL': uri(shell_small, 'WEBP', quality=80), 'HUB_SMALL': uri(hub_small, 'WEBP', quality=82), 'ENAMEL': uri(enamel, 'JPEG', quality=50), **KEYS,
}
with open(OUT, 'w') as f:
    f.write('// Generated by tools/gen_assets.py from assets-src/. Do not edit by hand.\n')
    for k, v in out.items(): f.write('export const %s = %s\n' % (k, json.dumps(v)))
    f.write('export const CAT_HEAD_PIVOT = [%d, %d] as const\n' % HEAD_PIVOT)
    f.write('export const CAT_GRID = %d\nexport const CAT_TAIL_PIVOT = [%.1f, %.1f] as const\n' % (G, 946, 1050))
print({k: len(v) for k, v in out.items()}, 'total', sum(len(v) for v in out.values()))
