"""Push the same private archived snapshot through the existing HTTPS site entrance."""
import base64
import json
import os
import pathlib
import time
import urllib.request

root=pathlib.Path('payload')
manifest=json.loads((root/'manifest.json').read_bytes())
files={name:base64.b64encode((root/name).read_bytes()).decode('ascii') for name in ('latest.json.gz','history.sqlite.gz')}
body=json.dumps({'manifest':manifest,'files':files},separators=(',',':')).encode()
if len(body)>24*1024*1024:
    raise ValueError('site package exceeds bounded import size')
secret=os.environ['STEAM_PUBLISH_TOKEN']
for attempt in range(3):
    try:
        request=urllib.request.Request('https://appgap.if2.ai/api/steam/publish',data=body,headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=120) as response:
            result=json.load(response)
        assert result.get('ok') is True
        print('STEAM_SITE_PUBLISH_OK',result['runId'],'cached',result.get('cached'))
        break
    except Exception:
        if attempt==2:raise
        time.sleep(5*(attempt+1))
