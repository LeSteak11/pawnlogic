from pathlib import Path
root = Path(SPECPATH).parent
a = Analysis([str(root / 'run.py')], pathex=[str(root)],
    binaries=[(str(root / 'engine/stockfish.exe'), 'engine')],
    datas=[(str(root / 'app/static'), 'app/static'),
           (str(root / 'build/release.json'), '.'),
           (str(root / 'build/licenses'), 'licenses'), (str(root / 'VERSION'), '.')],
    hiddenimports=['uvicorn.logging', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto',
                   'uvicorn.protocols.http.h11_impl', 'uvicorn.protocols.websockets.auto',
                   'uvicorn.lifespan.on'],
    excludes=['PIL', 'pytest', 'tkinter'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ChessLab',
    console=False, icon=str(root / 'app/static/icons/favicon.ico'))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='ChessLab')
