"""Consistent Steam SQLite copy plus the atomic published snapshot, compressed."""
import gzip
import pathlib
import shutil
import sqlite3
import sys

root = pathlib.Path('/var/lib/appgap/steam')
destination = pathlib.Path(sys.argv[1])
source_path = root/'history.sqlite'
if source_path.exists():
    temporary = destination.with_suffix('.steam.sqlite')
    try:
        with sqlite3.connect(source_path) as source, sqlite3.connect(temporary) as target:
            source.backup(target)
            if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Steam backup integrity check failed')
        with temporary.open('rb') as source, gzip.open(str(temporary)+'.gz','wb') as target:
            shutil.copyfileobj(source,target)
    finally:
        temporary.unlink(missing_ok=True)
if (root/'latest.json').exists():
    with (root/'latest.json').open('rb') as source, gzip.open(str(destination)+'.steam.json.gz','wb') as target:
        shutil.copyfileobj(source,target)
