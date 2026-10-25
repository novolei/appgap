"""Create only the dedicated Steam-data capability; preserve existing configuration bytes."""
import os
import pathlib
import secrets
import sys

path=pathlib.Path('/etc/appgap.env')
content=path.read_bytes()
prefix=b'STEAM_PUBLISH_TOKEN='
line=next((line for line in content.splitlines() if line.startswith(prefix)),None)
if line is None:
    token=secrets.token_urlsafe(32).encode()
    temporary=path.with_suffix('.steam-new')
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'wb') as stream:
        stream.write(content.rstrip(b'\n')+b'\n'+prefix+token+b'\n')
        stream.flush();os.fsync(stream.fileno())
    temporary.replace(path)
else:
    token=line[len(prefix):]
if '--export-to-secret-stdin' in sys.argv:
    sys.stdout.buffer.write(token)
else:
    print('STEAM_PUBLISH_CAPABILITY_READY')
