import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';

const temporary = mkdtempSync(join(tmpdir(), 'appgap-smoke-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep + 'appgap-smoke-'));
const child = spawn(process.execPath, ['dist-server/index.js'], { env: { ...process.env, PORT: '0', PUBLIC_ORIGIN: 'https://appgap.test', SITE_PASSWORD: 'test-runtime-password', APPGAP_DB: join(temporary, 'test.sqlite') }, stdio: ['ignore','pipe','pipe'] });
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
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(9000)})).status,413);
  const codes = await Promise.all(Array.from({length:6},async()=> (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'192.0.2.10'},body:JSON.stringify({password:'wrong'})})).status));
  assert.equal(codes.filter((c)=>c===429).length,1);
  console.log('SERVER_SMOKE_OK login, assets, saved pools, CSRF, ingest gate, body limit, parallel login throttling');
} finally {
  child.kill(); await exited; rmSync(temporary,{recursive:true,force:true});
}
