"""Generate release metadata, extension icons/ZIP, and license materials."""
import argparse
import hashlib
import json
import re
import subprocess
import urllib.request
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def download(url, target):
    with urllib.request.urlopen(url, timeout=60) as response:
        target.write_bytes(response.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        raise SystemExit('Version must be MAJOR.MINOR.PATCH')
    build, dist = ROOT / 'build', ROOT / 'dist'
    build.mkdir(exist_ok=True)
    dist.mkdir(exist_ok=True)
    h = hashlib.sha256()
    for item in sorted((ROOT / 'app').rglob('*')):
        if item.is_file() and item.suffix in ('.py', '.js', '.css', '.html', '.png', '.ico', '.svg'):
            h.update(str(item.relative_to(ROOT)).encode())
            h.update(item.read_bytes())
    h.update((ROOT / 'run.py').read_bytes())
    (build / 'release.json').write_text(json.dumps({'app': 'ChessLab', 'release': args.version,
        'version': h.hexdigest()[:16]}, indent=2), encoding='utf-8')
    icons = ROOT / 'extension/icons'
    icons.mkdir(exist_ok=True)
    with Image.open(ROOT / 'app/static/icons/icon-512.png') as icon:
        for size in (16, 32, 48, 128):
            icon.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'icon-{size}.png')
    archive = dist / f'ChessLab-Sync-{args.version}.zip'
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    manifest['version'] = args.version
    manifest['icons'] = {str(size): f'icons/icon-{size}.png' for size in (16, 32, 48, 128)}
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2))
        for filename in ('background.js', 'content.js'):
            z.write(ROOT / 'extension' / filename, filename)
        for icon in icons.glob('*.png'):
            z.write(icon, 'icons/' + icon.name)
    licenses = build / 'licenses'
    licenses.mkdir(exist_ok=True)
    result = subprocess.run([str(ROOT / 'engine/stockfish.exe')], input='uci\nquit\n',
        capture_output=True, text=True, timeout=15)
    identity = re.search(r'^id name (.+)$', result.stdout, re.M)
    engine_name = identity[1].strip() if identity else ''
    match = re.fullmatch(r'Stockfish (\d+(?:\.\d+)?)', engine_name)
    if not match:
        raise SystemExit(f'Cannot determine exact Stockfish source release: {engine_name!r}')
    tag = f'sf_{match[1]}'
    source_url = f'https://github.com/official-stockfish/Stockfish/tree/{tag}'
    download(f'https://raw.githubusercontent.com/official-stockfish/Stockfish/{tag}/Copying.txt', licenses / 'Stockfish-GPL-3.0.txt')
    (licenses / 'Stockfish-source.txt').write_text(f'{engine_name}\nExact corresponding source: {source_url}\nBinary SHA256: {hashlib.sha256((ROOT / "engine/stockfish.exe").read_bytes()).hexdigest()}\n', encoding='utf-8')
    download('https://raw.githubusercontent.com/niklasf/python-chess/master/LICENSE.txt', licenses / 'python-chess-GPL-3.0.txt')
    maia_revision = '1e13597c42d4858b7cfd7cfdae01e297263364b2'
    download(f'https://raw.githubusercontent.com/CSSLab/maia3/{maia_revision}/LICENSE', licenses / 'Maia3-AGPL-3.0.txt')
    (licenses / 'Maia3-source.txt').write_text(
        f'Maia-3 inference code\nExact corresponding source: https://github.com/CSSLab/maia3/tree/{maia_revision}\n'
        'Model checkpoints download separately from https://huggingface.co/collections/MaiaChess/maia3\n', encoding='utf-8')
    (licenses / 'THIRD-PARTY.txt').write_text('Stockfish and python-chess: GPL-3.0; see bundled licenses and source links.\npython-chess source: https://github.com/niklasf/python-chess\nMaia-3 inference code: AGPL-3.0; see bundled license and exact source link.\nMaia-3 checkpoints download separately from the official UofTCSSLab Hugging Face repositories.\nMerida pieces: Armando Hernandez Marroquin, GPLv2+; https://github.com/lichess-org/lila\nFastAPI and Uvicorn: MIT.\nPyInstaller: GPL with bootloader exception.\nCanvas confetti license is in app/static/vendor.\n', encoding='utf-8')
    print(f'Prepared release {args.version}; extension: {archive}')


if __name__ == '__main__':
    main()
