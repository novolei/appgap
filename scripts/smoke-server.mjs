import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';

const temporary = mkdtempSync(join(tmpdir(), 'appgap-smoke-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep + 'appgap-smoke-'));
const pythonProbe=spawnSync(process.platform==='win32'?'python':'python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8',windowsHide:true});
assert.equal(pythonProbe.status,0,pythonProbe.stderr);
const pythonBin=pythonProbe.stdout.trim();
const publishToken='local-test-steam-data-token-0123456789';
const fixture=String.raw`
import json,sys,pathlib,sqlite3,base64
from datetime import datetime,timedelta,timezone
sys.path.insert(0,str(pathlib.Path.cwd()/'scripts/steam'))
from collect import normalize_game
from analysis import analyze
from publish_branch import package
root=pathlib.Path(sys.argv[1]);source=root/'fixture';source.mkdir()
now=datetime.now(timezone.utc)
games={str(i):normalize_game({'appid':i,'success':1,'visible':True,'type':0,'name':'Fixture '+str(i),'is_free':True,'tagids':[1]},{'1':'Puzzle'})for i in range(1,51)}
data=analyze({'schemaVersion':1,'runId':1,'date':now.date().isoformat(),'capturedAt':now.isoformat(),'startedAt':now.isoformat(),'countries':[{'id':'GLOBAL','name':'Global'}]+[{'id':'A'+chr(65+i),'name':'Fixture'}for i in range(25)],'games':games,'ranks':[{'country':'GLOBAL','chart':'sales','rank':i,'appId':str(i)}for i in range(1,51)],'reviewWindow':{'start':int((now-timedelta(days=30)).timestamp()),'end':int(now.timestamp()),'days':30},'coverage':[],'sources':[],'reviewCoverage':{'targeted':0,'succeeded':0}})
(source/'latest.json').write_text(json.dumps(data),encoding='utf-8')
db=sqlite3.connect(source/'history.sqlite');db.execute('CREATE TABLE runs(id INTEGER PRIMARY KEY,status TEXT,payload TEXT)');db.execute('INSERT INTO runs VALUES(?,?,?)',(1,'success',json.dumps(data)));db.commit();db.close()
manifest=package(source,root/'payload')
(root/'publish.json').write_text(json.dumps({'manifest':manifest,'files':{name:base64.b64encode((root/'payload'/name).read_bytes()).decode()for name in manifest['files']}}),encoding='utf-8')
`;
const fixtureRun=spawnSync(pythonBin,['-c',fixture,temporary],{encoding:'utf8',windowsHide:true});
assert.equal(fixtureRun.status,0,fixtureRun.stderr);
const child = spawn(process.execPath, ['dist-server/index.js'], { env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: 'https://appgap.test', SITE_PASSWORD: 'test-runtime-password', APPGAP_DB: join(temporary, 'test.sqlite'), STEAM_PUBLISH_TOKEN:publishToken, PYTHON_BIN:pythonBin }, stdio: ['ignore','pipe','pipe'],windowsHide:true });
let output = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { output += data; });
const exited = once(child, 'exit');
try {
  for (let i=0; i<100 && !/ready on 127.0.0.1:(\d+)/.test(output); i++) {
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r,50));
  }
  const port = output.match(/ready on 127.0.0.1:(\d+)/)?.[1];
  assert.ok(port, output);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/pools')).status,401);
  assert.match(await (await fetch(base)).text(),/内部工具/);
  const login = await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-runtime-password'})});
  assert.equal(login.status,200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const home = await fetch(base,{headers:{cookie}});
  assert.match(await home.text(),/type="module"/);
  const index = readFileSync('dist/index.html','utf8');
  const asset = index.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(base+asset,{headers:{cookie}})).status,200);
  const headers = {cookie,'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/pools',{method:'POST',headers,body:JSON.stringify({appId:'123',pool:'build'})})).status,200);
  assert.deepEqual(await (await fetch(base+'/api/pools',{headers})).json(),{watch:[],build:['123']});
  assert.equal((await fetch(base+'/api/pools',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/ingest',{method:'POST',headers})).status,403);
  assert.equal((await fetch(base+'/api/steam/publish',{method:'POST',body:'x'.repeat(9000)})).status,401);
  const publishBody=readFileSync(join(temporary,'publish.json'),'utf8');
  const publishHeaders={'content-type':'application/json',authorization:'Bearer '+publishToken};
  const publish=await fetch(base+'/api/steam/publish',{method:'POST',headers:publishHeaders,body:publishBody});
  assert.equal(publish.status,200,await publish.text());
  const steamView=await (await fetch(base+'/api/steam/view?country=ALL',{headers})).json();
  assert.equal(steamView.summary.n,50);
  assert.equal(steamView.status.source,'github-actions');
  const repeated=await (await fetch(base+'/api/steam/publish',{method:'POST',headers:publishHeaders,body:publishBody})).json();
  assert.equal(repeated.cached,true);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(9000)})).status,413);
  const codes = await Promise.all(Array.from({length:6},async()=> (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'192.0.2.10'},body:JSON.stringify({password:'wrong'})})).status));
  assert.equal(codes.filter((c)=>c===429).length,1);
  console.log('SERVER_SMOKE_OK login, assets, saved pools, CSRF, ingest gate, body limit, parallel login throttling, authenticated Steam import, Python validation, rendered data view, idempotency');
} finally {
  child.kill(); await exited; rmSync(temporary,{recursive:true,force:true});
}
