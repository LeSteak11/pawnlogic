from pathlib import Path
from PyInstaller.utils.hooks import collect_all
root = Path(SPECPATH).parent
version = (root / 'VERSION').read_text().strip()
maia_datas, maia_binaries, maia_hiddenimports = collect_all('maia3')
a = Analysis([str(root / 'run.py')], pathex=[str(root)],
    # engine/stockfish comes from scripts/build-stockfish-mac.sh (a plain x86_64 build).
    binaries=[(str(root / 'engine/stockfish'), 'engine')] + maia_binaries,
    datas=[(str(root / 'app/static'), 'app/static'),
           (str(root / 'build/release.json'), '.'),
           (str(root / 'build/licenses'), 'licenses'), (str(root / 'VERSION'), '.')] + maia_datas,
    hiddenimports=['uvicorn.logging', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto',
                   'uvicorn.protocols.http.h11_impl', 'uvicorn.protocols.websockets.auto',
                   'uvicorn.lifespan.on'] + maia_hiddenimports,
    excludes=['PIL', 'pytest', 'tkinter'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ChessLab',
    console=False, target_arch='x86_64')
maia_a = Analysis([str(root / 'maia3_uci.py')], pathex=[str(root)],
    binaries=maia_binaries, datas=maia_datas, hiddenimports=maia_hiddenimports,
    excludes=['PIL', 'pytest', 'tkinter'], noarchive=False)
maia_pyz = PYZ(maia_a.pure)
maia_exe = EXE(maia_pyz, maia_a.scripts, [], exclude_binaries=True, name='Maia3UCI',
    console=True, target_arch='x86_64')
coll = COLLECT(exe, maia_exe, a.binaries, a.datas, maia_a.binaries, maia_a.datas,
    strip=False, upx=False, name='ChessLab')
app = BUNDLE(coll, name='Chess Lab.app', icon=str(root / 'build/ChessLab.icns'),
    bundle_identifier='io.github.lesteak11.chesslab', version=version,
    info_plist={'CFBundleShortVersionString': version, 'CFBundleVersion': version,
                'LSMinimumSystemVersion': '11.0', 'NSHighResolutionCapable': True,
                # The UI lives in a browser app window; no Dock icon for the service.
                'LSUIElement': True})
