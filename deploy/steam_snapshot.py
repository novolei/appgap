"""Bounded snapshot validation and atomic website data installation."""
import gzip
import hashlib
import io
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from contextlib import closing

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/steam'))
from locking import collector_lock
from collect import atomic_json

def unpack(compressed,maximum):
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        value=stream.read(maximum+1)
    if len(value)>maximum:
        raise ValueError('decompressed payload exceeds budget')
    return value


def install(directory,manifest,files):
    if set(manifest['files'])!={'latest.json.gz','history.sqlite.gz'} or set(files)!=set(manifest['files']):
        raise ValueError('unexpected package files')
    for name,description in manifest['files'].items():
        if name not in ('latest.json.gz','history.sqlite.gz') or description['bytes']>8*1024*1024 or len(files[name])!=description['bytes'] or hashlib.sha256(files[name]).hexdigest()!=description['sha256']:
            raise ValueError('invalid payload checksum or size')
    raw=unpack(files['latest.json.gz'],25*1024*1024)
    if hashlib.sha256(raw).hexdigest()!=manifest['sha256']:
        raise ValueError('snapshot checksum mismatch')
    data=json.loads(raw)
    if data['schemaVersion']!=1 or len(data['games'])<50 or not 25<=len(data['countries'])<=64:
        raise ValueError('snapshot structure or region coverage invalid')
    captured=datetime.fromisoformat(data['capturedAt'])
    if (captured-datetime.now(timezone.utc)).total_seconds()>1800:
        raise ValueError('snapshot timestamp is in the future')
    review=data['reviewCoverage']
    if review['targeted'] and review['succeeded']/review['targeted']<.9:
        raise ValueError('review source incomplete')
    keys=[(row['country'],row['chart'],row['appId']) for row in data['ranks']]
    if len(keys)!=len(set(keys)) or any(row['appId'] not in data['games'] or not 1<=row['rank']<=100 for row in data['ranks']):
        raise ValueError('invalid rank grain')
    previous=directory/'latest.json'
    if previous.exists():
        old=json.loads(previous.read_bytes())
        if old['capturedAt']>data['capturedAt']:
            raise ValueError('refusing to replace a newer snapshot')
    history=unpack(files['history.sqlite.gz'],128*1024*1024)
    with tempfile.TemporaryDirectory(prefix='incoming-',dir=directory) as temporary:
        stage=pathlib.Path(temporary)
        (stage/'latest.json').write_bytes(raw)
        history_file=stage/'history.sqlite'
        history_file.write_bytes(history)
        with closing(sqlite3.connect(f'file:{history_file.as_posix()}?mode=ro',uri=True)) as database:
            if database.execute('PRAGMA quick_check').fetchone()[0]!='ok':
                raise ValueError('history integrity failed')
            saved=database.execute("SELECT payload FROM runs WHERE id=? AND status='success'",(data['runId'],)).fetchone()
            if not saved or json.loads(saved[0])!=data:
                raise ValueError('history does not match the published snapshot')
        if (directory/'history.sqlite').exists():
            with closing(sqlite3.connect(directory/'history.sqlite',timeout=10)) as old:
                if old.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0]:
                    raise ValueError('history writer still active')
        os.chmod(history_file,0o600)
        os.chmod(stage/'latest.json',0o600)
        os.replace(history_file,directory/'history.sqlite')
        os.replace(stage/'latest.json',previous)
    atomic_json(directory/'status.json',{'status':'success','source':'github-actions','runId':data['runId'],'finishedAt':data['capturedAt'],'games':len(data['games']),'ranks':len(data['ranks']),'reviewCoverage':review,'checkedAt':datetime.now(timezone.utc).isoformat()})
    print('STEAM_IMPORT_OK',data['runId'],len(data['games']),review)
