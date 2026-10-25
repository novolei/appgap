"""Read-only private GitHub pull. Validate bounded payloads before replacing website data."""
import argparse
import gzip
import hashlib
import io
import json
import os
import pathlib
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import ipaddress
import urllib.request
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
    print('STEAM_SYNC_OK',data['runId'],len(data['games']),review)


def sync(directory,credentials):
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    if shutil.disk_usage(directory).free<1024*1024*1024:
        raise ValueError('less than 1 GiB disk headroom; keeping existing data')
    mirror=directory/'mirror.git'
    # The VPS resolver returned a non-GitHub address; override only this pinned SSH connection.
    addresses=[]
    for resolver in ('https://dns.alidns.com/resolve?name=ssh.github.com&type=A&edns_client_subnet=8.8.8.0%2F24','https://doh.pub/resolve?name=ssh.github.com&type=A'):
        try:
            with urllib.request.urlopen(resolver,timeout=8) as response:
                answer=json.loads(response.read(65536))
            addresses.extend(row['data'] for row in answer.get('Answer',[]) if row.get('type')==1 and ipaddress.ip_address(row['data']).version==4 and ipaddress.ip_address(row['data']).is_global)
        except (OSError,ValueError):continue
    if not addresses:
        raise ValueError('trusted HTTPS DNS did not return a public GitHub SSH address')
    environment={**os.environ,'GIT_TERMINAL_PROMPT':'0'}
    def git(*args):
        return subprocess.check_output(['git','--git-dir='+str(mirror),*args],env=environment,timeout=90)
    if not mirror.exists():
        subprocess.run(['git','init','--bare',str(mirror)],check=True,capture_output=True)
    for address in dict.fromkeys(addresses):
        environment['GIT_SSH_COMMAND']=f"ssh -F /dev/null -i {shlex.quote(str(credentials/'github-deploy-key'))} -o HostName={address} -o HostKeyAlias='[ssh.github.com]:443' -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/appgap-github-known-hosts"
        try:
            git('fetch','--depth=1','--no-tags','--force','ssh://git@ssh.github.com:443/novolei/appgap-steam-data.git','refs/heads/snapshot:refs/heads/snapshot')
            break
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
            continue
    else:
        raise ValueError('all pinned GitHub SSH connections failed; keeping existing snapshot')
    git('gc','--prune=now')
    def read(name,maximum):
        object_name='refs/heads/snapshot:payload/'+name
        if int(git('cat-file','-s',object_name))>maximum:
            raise ValueError('git payload exceeds budget')
        return git('show',object_name)
    manifest=json.loads(read('manifest.json',8192))
    if (directory/'manifest.json').exists() and json.loads((directory/'manifest.json').read_bytes()).get('sha256')==manifest['sha256']:
        print('STEAM_SYNC_UNCHANGED');return
    files={name:read(name,8*1024*1024) for name in ('latest.json.gz','history.sqlite.gz')}
    install(directory,manifest,files)
    atomic_json(directory/'manifest.json',manifest)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=pathlib.Path,default=pathlib.Path('/var/lib/appgap/steam'))
    parser.add_argument('--credentials',type=pathlib.Path,required=True)
    args=parser.parse_args()
    with collector_lock(args.directory):
        try:sync(args.directory,args.credentials)
        except Exception as error:
            atomic_json(args.directory/'status.json',{'status':'error','source':'github-actions','error':str(error)[:400],'checkedAt':datetime.now(timezone.utc).isoformat()})
            raise
