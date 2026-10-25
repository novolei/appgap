"""Publish only bounded generated payloads to an independent root-commit data branch."""
import argparse
import gzip
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
from contextlib import closing


def package(directory, output):
    raw = (directory/'latest.json').read_bytes()
    snapshot = json.loads(raw)
    coverage = snapshot['reviewCoverage']
    if coverage['targeted'] and coverage['succeeded']/coverage['targeted'] < .9:
        raise ValueError('review coverage below 90%; keep the last good published dataset')
    output.mkdir(parents=True,exist_ok=True)
    (output/'latest.json.gz').write_bytes(gzip.compress(raw,mtime=0))
    temporary = output/'history.sqlite'
    try:
        with closing(sqlite3.connect(directory/'history.sqlite')) as source, closing(sqlite3.connect(temporary)) as target:
            source.backup(target)
            target.execute("UPDATE runs SET payload=NULL WHERE id NOT IN (SELECT id FROM runs WHERE status='success' ORDER BY id DESC LIMIT 2)")
            target.commit()
            target.execute('VACUUM')
            assert target.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
        if temporary.stat().st_size > 128*1024*1024:
            raise ValueError('history budget exceeded')
        (output/'history.sqlite.gz').write_bytes(gzip.compress(temporary.read_bytes(),mtime=0))
    finally:
        temporary.unlink(missing_ok=True)
    sizes={name:(output/name).stat().st_size for name in ['latest.json.gz','history.sqlite.gz']}
    if len(raw)>25*1024*1024 or max(sizes.values())>8*1024*1024:
        raise ValueError('published snapshot exceeds file budget')
    manifest={'schemaVersion':1,'runId':snapshot['runId'],'capturedAt':snapshot['capturedAt'],'sha256':hashlib.sha256(raw).hexdigest(),'uncompressedBytes':len(raw),'files':{name:{'bytes':size,'sha256':hashlib.sha256((output/name).read_bytes()).hexdigest()} for name,size in sizes.items()},'reviewCoverage':coverage}
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    return manifest


def publish(directory, repository, prepared=False):
    output=repository/'payload'
    manifest=json.loads((output/'manifest.json').read_bytes()) if prepared else package(directory,output)
    if prepared:
        assert all(hashlib.sha256((output/name).read_bytes()).hexdigest()==description['sha256'] for name,description in manifest['files'].items())
    def git(*args,env=None):
        return subprocess.check_output(['git','-C',str(repository),*args],env=env,text=True).strip()
    old=git('ls-remote','origin','refs/heads/snapshot').split()
    with tempfile.TemporaryDirectory(prefix='appgap-data-index-') as temporary:
        environment={**os.environ,'GIT_INDEX_FILE':str(pathlib.Path(temporary)/'index')}
        git('read-tree','--empty',env=environment)
        git('add','--force','--','payload/latest.json.gz','payload/history.sqlite.gz','payload/manifest.json',env=environment)
        tree=git('write-tree',env=environment)
        commit=git('-c','user.name=AppGap Data','-c','user.email=appgap-data@users.noreply.github.com','commit-tree',tree,'-m',f"Steam snapshot {manifest['capturedAt']}")
        git('push',f"--force-with-lease=refs/heads/snapshot:{old[0] if old else ''}",'origin',f'{commit}:refs/heads/snapshot')
    print('SNAPSHOT_BRANCH_PUBLISHED',manifest['runId'],manifest['files'])


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=pathlib.Path,required=True)
    parser.add_argument('--repository',type=pathlib.Path,default=pathlib.Path.cwd())
    parser.add_argument('--package-only',action='store_true')
    parser.add_argument('--prepared',action='store_true')
    args=parser.parse_args()
    if args.package_only:
        print(json.dumps(package(args.directory.resolve(),args.repository.resolve()/'payload')))
    else:
        publish(args.directory.resolve(),args.repository.resolve(),args.prepared)
