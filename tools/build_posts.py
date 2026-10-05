"""Erzeugt public/posts/<slug>/*.jpg und public/posts.json aus den fertigen Karussells.

Aufruf:  python tools/build_posts.py [Quellordner]
Standard-Quellordner: ~/Desktop/Posts (ein Unterordner pro Post, Slides als 1_xxx.jpg, 2_xxx.jpg …,
dazu Beschreibung.txt mit den Abschnitten ENGLISH / DEUTSCH / QUELLEN).

Reihenfolge und „Neu"-Markierung stehen in ORDER. Neuer Post = Zeile ergänzen und Skript neu laufen lassen.
Die Abstimmungen hängen an der Post-ID (aus dem Ordnernamen) – Ordner also nicht umbenennen.
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'posts'
MANIFEST = ROOT / 'public' / 'posts.json'
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Desktop' / 'Posts'

# (Ordnername, neu?) – oben steht, was zuerst angezeigt wird
ORDER = [
    ('Your neighbours hate this sound', True),
    ('Tap the racket', True),
    ('Your court is blue', True),
    ('Bankers left golf for padel', True),
    ('A point lasts 11 seconds', True),
    ('Autumn changed your game', False),
    ('The secret language behind your back', False),
    ('Lies every padel player tells', False),
    ('Padel partner red flags', False),
    ('41 hours of padel', False),
    ('Your ball is yellow', False),
]

LARGE, SMALL = 1080, 540  # Breite in px; kleiner wird nicht hochskaliert


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def sections(text):
    """Zerlegt Beschreibung.txt in {'ENGLISH': …, 'DEUTSCH': …, 'QUELLEN': …}."""
    lines = text.replace('\r\n', '\n').split('\n')
    found, current = {}, None
    for i, line in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        if line.strip() in ('ENGLISH', 'DEUTSCH', 'QUELLEN') and set(nxt.strip()) == {'-'}:
            current = line.strip()
            found[current] = []
            continue
        if current and not (set(line.strip()) == {'-'} and found[current] == []):
            found[current].append(line)
    return {k: '\n'.join(v).strip() for k, v in found.items()}


def save(img, width, path, quality):
    w, h = img.size
    if w > width:
        img = img.resize((width, round(h * width / w)), Image.LANCZOS)
    img.save(path, 'JPEG', quality=quality, optimize=True, progressive=True)
    return img.size


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    posts = []
    for folder, is_new in ORDER:
        src = SRC / folder
        files = sorted(
            (f for f in src.iterdir() if re.match(r'^\d+_.*\.jpe?g$', f.name, re.I)),
            key=lambda f: int(f.name.split('_', 1)[0]),
        )
        if not files:
            sys.exit(f'Keine Slides in {src}')
        pid = slug(folder)
        (OUT / pid).mkdir()
        slides = []
        for n, f in enumerate(files, 1):
            img = Image.open(f).convert('RGB')
            big = f'{n:02d}.jpg'
            small = f'{n:02d}_s.jpg'
            w, h = save(img, LARGE, OUT / pid / big, 82)
            sw, _ = save(img, SMALL, OUT / pid / small, 78)
            slides.append({'src': f'posts/{pid}/{big}', 'w': w, 'h': h,
                           'small': f'posts/{pid}/{small}', 'sw': sw})
        text = sections((src / 'Beschreibung.txt').read_text(encoding='utf-8'))
        sources = [s.strip() for s in text.get('QUELLEN', '').split('\n') if s.strip()]
        posts.append({
            'id': pid,
            'title': folder,
            'isNew': is_new,
            'slides': slides,
            'caption': {'en': text.get('ENGLISH', ''), 'de': text.get('DEUTSCH', '')},
            'sources': sources,
        })
        print(f'{pid}: {len(slides)} Slides')
    MANIFEST.write_text(json.dumps({'posts': posts}, ensure_ascii=False, indent=1), encoding='utf-8')
    total = sum(p.stat().st_size for p in OUT.rglob('*.jpg'))
    print(f'{len(posts)} Posts, {total / 1e6:.1f} MB -> {MANIFEST}')


if __name__ == '__main__':
    main()
