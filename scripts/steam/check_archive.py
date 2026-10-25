"""Verify archived source bytes against the snapshot without extracting tar paths."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

def check_archive(directory, archive):
    data=json.loads((directory/'latest.json').read_bytes())
    expected={row['label']:row for row in data['sources']}
    if not expected or len(expected)!=len(data['sources']) or len(expected)>10000:
        raise ValueError('missing, duplicate or excessive source receipts')
    if archive.stat().st_size>32*1024*1024 or sum(row['bytes'] for row in expected.values())>256*1024*1024:
        raise ValueError('source archive exceeds budget')
    seen=set()
    with tarfile.open(archive,'r:gz') as source:
        for member in source:
            path=PurePosixPath(member.name)
            if member.isdir():continue
            label=path.stem
            if not member.isfile() or '..' in path.parts or path.parts[:2]!=('raw',str(data['runId'])) or not re.fullmatch(r'[A-Za-z0-9_-]+',label) or label not in expected or label in seen:
                raise ValueError('unexpected archived source path')
            receipt=expected[label]
            if member.size!=receipt['bytes'] or member.size>12*1024*1024:
                raise ValueError('archived source size mismatch')
            raw=source.extractfile(member).read(12*1024*1024+1)
            if hashlib.sha256(raw).hexdigest()!=receipt['sha256']:
                raise ValueError('archived source checksum mismatch')
            seen.add(label)
    if seen!=set(expected):raise ValueError('source archive is incomplete')
    print('RAW_SOURCE_ARCHIVE_OK',len(seen),flush=True)
    return len(seen)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--archive',type=Path,required=True)
    args=parser.parse_args()
    check_archive(args.directory,args.archive)
