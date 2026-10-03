# Cuts the cavapoo (assets-src/pets/cavapoo.svg) into the pieces the mod moves,
# the same pieces the cats are cut into: body, head, tail and two front paws.
# Her drawing is too detailed to embed as vectors, so each piece is rendered
# to a PNG on the whole 1254 canvas (they stack back into the dog) and the PNGs
# are committed; gen_assets.py then needs only Pillow. Needs Google Chrome.
#   python3 tools/render_pet_layers.py
import os, re, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PETS = os.path.join(ROOT, 'assets-src', 'pets')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SIZE, CANVAS = 256, 1254

# Where she is cut, in her canvas: the neck, and the two front paws. The body
# keeps a band above the neck so a tilted head never opens a gap, and each paw
# reaches a little past the hole cut for it, so their soft edges overlap
# instead of leaving a seam.
HEAD_CUT, HEAD_OVERLAP = 800, 40
# Each box holds one front paw only, from where the leg narrows to the toes: the
# hind leg on either side stays with the body.
PAWS = {'paw-left': (410, 1095, 594, 1210), 'paw-right': (645, 1095, 817, 1210)}
PAW_OVERLAP = 6

def box(b):
    return 'M%d %dH%dV%dH%dZ' % (b[0], b[1], b[2], b[3], b[0])

svg = open(os.path.join(PETS, 'cavapoo.svg')).read()
inner = svg[svg.index('>', svg.index('<svg')) + 1:svg.rindex('</svg>')]
inner = re.sub(r'<title>.*?</title>|<desc>.*?</desc>', '', inner, flags=re.S)
tail = re.search(r'<g id="tail">.*?</g>', inner, re.S).group(0)
rest = inner.replace(tail, '')

PIECES = {
    'tail': (None, tail),
    'head': ('M0 0H%dV%dH0Z' % (CANVAS, HEAD_CUT), rest),
    'body': ('M0 %dH%dV%dH0Z' % (HEAD_CUT - HEAD_OVERLAP, CANVAS, CANVAS) + ''.join(box(b) for b in PAWS.values()), rest),
    **{name: (box((b[0] - PAW_OVERLAP, b[1] - PAW_OVERLAP, b[2] + PAW_OVERLAP, b[3] + PAW_OVERLAP)), rest) for name, b in PAWS.items()},
}

with tempfile.TemporaryDirectory() as tmp:
    for name, (clip, content) in PIECES.items():
        body = content if clip is None else (
            '<defs><clipPath id="cut"><path clip-rule="evenodd" d="%s"/></clipPath></defs><g clip-path="url(#cut)">%s</g>' % (clip, content))
        path = os.path.join(tmp, name + '.svg')
        open(path, 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>' % (CANVAS, CANVAS, CANVAS, CANVAS, body))
        page = os.path.join(tmp, name + '.html')
        open(page, 'w').write('<body style="margin:0;background:transparent"><img src="%s.svg" width="%d" height="%d"></body>' % (name, SIZE, SIZE))
        out = os.path.join(PETS, 'cavapoo-' + name + '.png')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
                        '--window-size=%d,%d' % (SIZE, SIZE), '--screenshot=' + out, 'file://' + page], check=True, capture_output=True)
        print('wrote', out)
