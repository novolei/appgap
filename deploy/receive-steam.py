"""Receive a bounded authenticated data package; no network or command execution from data."""
import base64
import importlib.util
import json
import pathlib
import sys

root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('steam_sync',root/'sync-steam.py')
sync=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


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
    with sync.collector_lock(directory):
        current=directory/'manifest.json'
        if current.exists() and json.loads(current.read_bytes()).get('sha256')==manifest['sha256']:
            return {'ok':True,'cached':True,'runId':manifest['runId']}
        if sync.shutil.disk_usage(directory).free<1024*1024*1024:
            raise ValueError('less than 1 GiB disk headroom')
        sync.install(directory,manifest,files)
        sync.atomic_json(current,manifest)
    return {'ok':True,'cached':False,'runId':manifest['runId']}


if __name__=='__main__':
    directory=pathlib.Path(sys.argv[1])
    result=receive(directory,sys.stdin.buffer.read(24*1024*1024+1))
    print(json.dumps(result),flush=True)
