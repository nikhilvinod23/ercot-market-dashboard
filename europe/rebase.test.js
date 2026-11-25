import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboard} from './rebase.js';
import {ids} from './zones.js';

test('keyed integration discovers arbitrary fuel suffixes and follows a values cursor',async()=>{
 const before=process.env.REBASE_API_KEY;
 const original=globalThis.fetch;
 process.env.REBASE_API_KEY='test-key';
 const time='2026-11-09T00:00:00Z',border='border:DE-LU~FR',fuel=ids.fuel+'test_unknown_fuel';
 const asCatalog=(name)=>({name,provider:'entsoe'});
 let reads=0;
 globalThis.fetch=async(url,options)=>{
  assert.ok(url.startsWith('https://grid.rebase.energy/api/v1'));
  assert.equal(options.headers['X-API-Key'],'test-key');
  const path=new URL(url).pathname;
  if(path.endsWith('/entities')) return Response.json({entities:[{id:'Germany',children:[
   {kind:'price_zone',id:'DE-LU'},{kind:'price_zone',id:'FR'}]}]});
  if(path.endsWith('/DE-LU/timeseries')||path.endsWith('/FR/timeseries')){
   return Response.json({timeseries:[asCatalog(ids.price),asCatalog(ids.load),asCatalog(fuel)],
    relations:[{id:border,timeseries:[asCatalog(ids.flow)]}]});
  }
  assert.ok(path.endsWith('/timeseries/values'));
  const body=JSON.parse(options.body);
  const records=body.series.map(item=>({...item,unit:item.name===ids.price?'EUR/MWh':'MW',
   resolution:'PT15M',points:[{valid_time:time,knowledge_time:time,value:item.name===ids.price?-12:100}]}));
  reads++;
  return Response.json(body.cursor?{series:records.slice(3),next:null}:{series:records.slice(0,3),next:'page2'});
 };
 try {
  const result=await dashboard(Date.parse(time),false,'DE-LU');
  assert.equal(reads,2);
  assert.equal(result.zones.FR.price.value,-12);
  assert.equal(result.zones['DE-LU'].mix.fuels[0][0],'test_unknown_fuel');
  assert.equal(result.flows.length,1);
  assert.equal(result.flows[0].flow.value,100);
 } finally {
  globalThis.fetch=original;
  if(before===undefined)delete process.env.REBASE_API_KEY;
  else process.env.REBASE_API_KEY=before;
 }
});

