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

# Each cat is a traced vector, cut into pieces that move on the beat:
# - the tail, split off at x = split: a path wholly on one side goes to that
#   side, one that straddles the split is drawn on both, clipped;
# - the head, above y = head_cut: paths wholly above move to the head; one that
#   crosses the neck is drawn in both, the head's copy clipped at the cut and the
#   body's starting a little above it, so a tilted head never opens a gap;
# - two front paws, whose boxes are drawn a second time in groups of their own
#   and cut out of the body, so a paw can lift without leaving a copy behind.
# top, bottom, left and right are where the drawing's visible pixels start and end,
# as fractions of the canvas: the skins use them to stand a cat on a line.
import re
SIZE = 1254
HEAD_OVERLAP = 40

def cut_cat(name, split, paws, head_cut, head_pivot, tail_pivot, top, bottom, left, right):
    svg = open(A + name).read()
    body, tail, both, head, paw_paths = [], [], [], [], [[] for _ in paws]
    for tag in re.findall(r'<path[^>]*/>', svg):
        d = re.search(r' d="([^"]*)"', tag).group(1)
        fill = re.search(r'fill="([^"]*)"', tag).group(1)
        move = re.search(r'translate\(([-\d.]+),([-\d.]+)\)', tag)
        tx, ty = (float(move.group(1)), float(move.group(2))) if move else (0.0, 0.0)
        points = re.findall(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', d)
        xs = [float(x) + tx for x, _ in points]; ys = [float(y) + ty for _, y in points]
        d = re.sub(r'\s*([MLCZ])\s*', r'\1', d).strip()
        out = '<path fill="%s" d="%s"%s/>' % (fill, d, ' transform="%s"' % move.group(0) if move else '')
        if min(xs) < split and min(ys) < head_cut: head.append(out)
        if max(xs) <= split:
            if max(ys) > head_cut: body.append(out)
        else:
            (tail if min(xs) >= split else both).append(out)
        for box, paw in zip(paws, paw_paths):
            if min(xs) < box[2] and max(xs) > box[0] and min(ys) < box[3] and max(ys) > box[1]: paw.append(out)
    print(name, 'paths: body', len(body), 'tail', len(tail), 'both', len(both), 'head', len(head), 'paws', [len(p) for p in paw_paths])
    shared = ''.join(both)
    hole = 'M0 %dH%dV%dH0Z' % (head_cut - HEAD_OVERLAP, split, SIZE) + ''.join('M%d %dH%dV%dH%dZ' % (b[0], b[1], b[2], b[3], b[0]) for b in paws)
    return {
        'body': '<clipPath id="cl"><path clip-rule="evenodd" d="%s"/></clipPath><g clip-path="url(#cl)">%s%s</g>' % (hole, shared, ''.join(body)),
        'tail': ('<clipPath id="cr"><rect x="%d" width="%d" height="%d"/></clipPath><g clip-path="url(#cr)">%s</g>' % (split, SIZE - split, SIZE, shared)) + ''.join(tail),
        'head': '<clipPath id="ch"><rect width="%d" height="%d"/></clipPath><g clip-path="url(#ch)">%s</g>' % (split, head_cut, ''.join(head)),
        'pawLeft': ''.join(paw_paths[0]), 'pawRight': ''.join(paw_paths[1]),
        'pawClip': ''.join('<clipPath id="cp%d"><rect x="%d" y="%d" width="%d" height="%d"/></clipPath>' % (i, b[0], b[1], b[2] - b[0], b[3] - b[1]) for i, b in enumerate(paws)),
        'kind': 'cat', 'grid': SIZE, 'headPivot': list(head_pivot), 'tailPivot': list(tail_pivot), 'top': top, 'bottom': bottom, 'left': left, 'right': right,
    }

# The calico of Tape Club, and the ginger of ClaudeAmp.
CATS = {
    'CALICO': cut_cat('calico-cat.svg', 916, [(330, 1045, 488, 1152), (488, 1045, 632, 1152)], 715, (540, 730), (946, 1050), 0.116, 0.913, 0.13, 0.877),
    'GINGER': cut_cat('ginger-cat.svg', 900, [(350, 1000, 502, 1100), (505, 1000, 640, 1100)], 650, (530, 660), (930, 1040), 0.1475, 0.873, 0.2, 0.873),
}

enamel = Image.open(A + 'olive-enamel.png').convert('RGB').crop((0, 0, 1254, 1163)).resize((420, 390), Image.LANCZOS)

# The band above the prompt shows the same cassette about 170 px wide.
shell_small = Image.open(A + 'cassette-shell.png').convert('RGB').crop((84, 100, 1452, 922)).resize((352, 212), Image.LANCZOS)
hub_small = Image.open(A + 'cassette-hub.png').resize((76, 76), Image.LANCZOS)

# ClaudeAmp's parts: drawn at 2x and shown at half size. Lossy WebP keeps the
# whole set inside one drawing's size limit; the small ones stay lossless.
AMP_DIR = A + 'amp' + os.sep
def amp(name, quality=None):
    im = Image.open(AMP_DIR + name + '.png').convert('RGBA')
    return uri(im, 'WEBP', **({'quality': quality} if quality else {'lossless': True}))

metal = Image.open(AMP_DIR + 'brushed-metal.png').convert('RGB').crop((0, 0, 627, 627)).resize((192, 192), Image.LANCZOS)
AMP = {name: amp(name, 86) for name in ['btn-prev', 'btn-play', 'btn-pause', 'btn-next', 'btn-prev-down', 'btn-play-down', 'btn-pause-down', 'btn-next-down']}
AMP.update({name: amp(name) for name in ['btn-min', 'btn-close', 'toggle-off', 'toggle-on', 'speaker', 'slider-thumb']})
AMP.update({'titlebar': amp('titlebar', 84), 'lcd-glass': amp('lcd-glass', 90), 'metal': uri(metal, 'WEBP', quality=60)})

# The cavapoo is cut into the cats' pieces too, but rendered to pictures by
# tools/render_pet_layers.py: her drawing is too detailed to embed as vectors.
# Each picture spans the whole 1254 canvas, so the pieces stack back into her.
PET_DIR = A + 'pets' + os.sep
def pet_piece(name):
    return '<image href="%s" width="%d" height="%d"/>' % (uri(Image.open(PET_DIR + 'cavapoo-' + name + '.png').convert('RGBA'), 'WEBP', quality=86), SIZE, SIZE)

CAVAPOO = {
    'kind': 'cat', 'grid': SIZE,
    'body': pet_piece('body'), 'head': pet_piece('head'), 'tail': pet_piece('tail'),
    'pawLeft': pet_piece('paw-left'), 'pawRight': pet_piece('paw-right'),
    # the paw pictures are already cut; these clips only name them as the cats' do
    'pawClip': '<clipPath id="cp0"><rect x="404" y="1089" width="196" height="127"/></clipPath><clipPath id="cp1"><rect x="639" y="1089" width="184" height="127"/></clipPath>',
    'headPivot': [590, 805], 'tailPivot': [950, 1100],
    'top': 0.086, 'bottom': 0.965, 'left': 0.125, 'right': 0.922,
}

out = {
    'SHELL': uri(shell, 'WEBP', quality=70), 'HUB': uri(hub, 'WEBP', quality=82),
    'SHELL_SMALL': uri(shell_small, 'WEBP', quality=80), 'HUB_SMALL': uri(hub_small, 'WEBP', quality=82), 'ENAMEL': uri(enamel, 'JPEG', quality=50),
}
with open(OUT, 'w') as f:
    f.write('// Generated by tools/gen_assets.py from assets-src/. Do not edit by hand.\n')
    for k, v in out.items(): f.write('export const %s = %s\n' % (k, json.dumps(v)))
    f.write('export const AMP = %s as const\n' % json.dumps(AMP))
    f.write('export const CAVAPOO = %s as const\n' % json.dumps(CAVAPOO))
    for k, v in CATS.items(): f.write('export const %s = %s as const\n' % (k, json.dumps(v, ensure_ascii=False)))
print({k: len(v) for k, v in AMP.items()}); print('cavapoo', {k: len(v) for k, v in CAVAPOO.items() if isinstance(v, str)}); print({k: len(v) for k, v in out.items()}, {k: sum(len(x) for x in v.values() if isinstance(x, str)) for k, v in CATS.items()})
