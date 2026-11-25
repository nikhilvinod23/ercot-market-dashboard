import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateFuel,exchange,normalized,observation} from './market.js';
import {demo} from './demo.js';
import {boundaryIds,ids,minute} from './zones.js';

const start=Date.parse('2026-11-09T00:00:00Z');
const point=(offset,value)=>({valid_time:new Date(start+offset*minute).toISOString(),value,
 knowledge_time:'2026-11-09T01:00:00Z'});
const series=(name,points)=>({name:ids.fuel+name,provider:'entsoe',unit:'MW',resolution:'PT15M',points});
test('source provenance survives and stale values remain explicit',()=>{
 const sample=series('solar',[point(0,0),point(30,120)]);
 assert.equal(observation(sample,start).value,0);
 assert.equal(observation(sample,start+20*minute),null);
 assert.equal(observation(sample,start+20*minute,{carry:true}).stale,true);
 assert.equal(observation(sample,start).published,'2026-11-09T01:00:00Z');
});
test('fuel totals use a shared delivery timestamp and flag partial data',()=>{
 const gas=series('fossil_gas',[point(0,70),point(15,80)]);
 const solar=series('solar',[point(0,20)]);
 assert.equal(aggregateFuel([gas,solar],start+15*minute,true).total,90);
 assert.equal(aggregateFuel([gas,solar],start+15*minute,false).total,80);
 assert.equal(aggregateFuel([gas,solar],start+15*minute,false).partial,true);
});
test('physical directional signs and timestamp alignment',()=>{
 const flow={a:'FR',b:'ES',flow:{time:'x',value:-700}};
 assert.equal(exchange([flow],'FR',{time:'x',value:2000}).dependence,.35);
 assert.equal(exchange([flow],'ES',{time:'x',value:2000}).exports,700);
 assert.equal(exchange([flow],'ES',{time:'y',value:2000}).dependence,null);
});
test('negative prices and optional FX conversion',()=>{
 assert.equal(normalized({unit:'EUR/MWh',value:-30},'price',{},start).value,-30);
 assert.equal(normalized({unit:'GBP/MWh',value:75},'price',{},start),null);
 assert.equal(normalized({unit:'GBP/MWh',value:75},'price',{'2026-11-09':{GBP:.75}},start).value,100);
});
test('demo includes multisplit markets and independent data',()=>{
 const sample=demo(start,false);
 for(const id of ['NO-NO5','SE-SE4','DK-DK2','IT-CAL']){
  assert.ok(sample.zones[id].mix);
  assert.ok(boundaryIds.includes(id));
 }
 assert.equal(sample.mode,'demo');
 assert.ok(sample.flows.length>35);
 assert.ok(sample.zones['DE-LU'].load);
});

