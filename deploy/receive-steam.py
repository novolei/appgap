"""Receive a bounded authenticated data package; no network or command execution from data."""
import base64
import json
import pathlib
import sys
import shutil

root=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(root))
from steam_snapshot import install, atomic_json, collector_lock


def receive(directory,body):
    if len(body)>24*1024*1024:
        raise ValueError('request exceeds import budget')
    package=json.loads(body)
    manifest=package['manifest']
    if set(package['files'])!={'latest.json.gz','history.sqlite.gz'}:
        raise ValueError('unexpected package files')
    files={}
    for name,value in package['files'].items():
        if not isinstance(value,str) or len(value)>12*1024*1024:
            raise ValueError('encoded file exceeds import budget')
        files[name]=base64.b64decode(value,validate=True)
    with collector_lock(directory):
        current=directory/'manifest.json'
        if current.exists() and json.loads(current.read_bytes()).get('sha256')==manifest['sha256']:
            return {'ok':True,'cached':True,'runId':manifest['runId']}
        if shutil.disk_usage(directory).free<1024*1024*1024:
            raise ValueError('less than 1 GiB disk headroom')
        install(directory,manifest,files)
        atomic_json(current,manifest)
    return {'ok':True,'cached':False,'runId':manifest['runId']}


if __name__=='__main__':
    directory=pathlib.Path(sys.argv[1])
    result=receive(directory,sys.stdin.buffer.read(24*1024*1024+1))
    print(json.dumps(result),flush=True)
