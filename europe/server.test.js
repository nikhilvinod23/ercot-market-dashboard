import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './server.js';

async function request(url,method='GET'){
 const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=String(body);}};
 await handleRequest({url,method},response);
 return response;
}
test('dashboard request handler serves assets and historical synthetic snapshots',async()=>{
 const page=await request('/');
 assert.equal(page.status,200);
 assert.match(page.body,/European Power Markets/);
 for(const file of ['app.js','map.js','zones.js','market.js','styles.css']){
  const response=await request('/'+file);
  assert.equal(response.status,200);
  assert.match(response.headers['Content-Type'],/text\//);
 }
 const path='/api/dashboard?mode=demo&zone=IT-CAL&at=2026-11-01T12%3A00%3A00Z';
 const response=await request(path);
 assert.equal(response.status,200);
 const payload=JSON.parse(response.body);
 assert.equal(payload.time,Date.parse('2026-11-01T12:00:00Z'));
 assert.equal(payload.mode,'demo');
 assert.ok(payload.zones['IT-CAL'].mix.total>0);
 assert.ok(payload.series.every(s=>s.entity==='IT-CAL'||s.entity.includes('IT-CAL')));
 assert.equal((await request('/.env')).status,404);
 assert.equal((await request('/api/dashboard?zone=bad')).status,400);
 assert.equal((await request('/api/dashboard','POST')).status,405);
});

