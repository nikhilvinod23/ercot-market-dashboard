import {ids,zones,hour,minute} from './zones.js';
import {snapshot} from './market.js';

const api='https://grid.rebase.energy/api/v1';
const cached=new Map();
const key=()=>process.env.REBASE_API_KEY?.trim();
export async function rebase(path,body,apiKey=key()){
 const response=await fetch(api+path,{redirect:'error',signal:AbortSignal.timeout(65000),
  headers:{...(apiKey?{'X-API-Key':apiKey}:{}),...(body?{'Content-Type':'application/json'}:{})},
  method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
 if(!response.ok) throw new Error('Rebase HTTP '+response.status+' at '+path+
  (response.headers.has('retry-after')?' · Retry after '+response.headers.get('retry-after')+' seconds':''));
 return response.json();
}
function cache(id,ttl,compute){
 const hit=cached.get(id);
 if(hit?.until>Date.now()) return hit.promise;
 const entry={until:Date.now()+ttl,promise:null};
 entry.promise=Promise.resolve().then(compute).catch(error=>{
  if(cached.get(id)===entry) cached.delete(id);
  throw error;
 });
 cached.set(id,entry);
 for(const [id,v] of cached) if(v.until<Date.now()) cached.delete(id);
 return entry.promise;
}
export const entities=(apiKey=key())=>cache('entities:'+Boolean(apiKey),hour,()=>rebase('/entities',undefined,apiKey));
export function flatten(items){
 return items.flatMap(item=>[item,...flatten(item.children??[])]);
}
export const list=(id,apiKey=key())=>cache('catalog:'+id+':'+Boolean(apiKey),hour,()=>rebase('/entities/'+encodeURIComponent(id)+'/timeseries',undefined,apiKey));
function preferred(items){
 const byName=new Map();
 for(const item of items){
  if(!byName.has(item.name)||item.provider==='entsoe') byName.set(item.name,item);
 }
 return [...byName.values()];
}
export async function discover(wanted,partition,apiKey=key()){
 const discovery=flatten((await entities(apiKey)).entities);
 const marketIds=discovery.filter(e=>e.kind==='price_zone' && e.id in zones).map(e=>e.id);
 const zoneIds=apiKey?marketIds.filter((_,index)=>partition===undefined||index%3===partition):marketIds.filter(id=>id===wanted);
 const catalog={}, errors=[];
 // Small batches bound the burst of catalog requests.
 for(let offset=0;offset<zoneIds.length;offset+=5){
  const group=zoneIds.slice(offset,offset+5);
  const answers=await Promise.allSettled(group.map(id=>list(id,apiKey)));
  answers.forEach((answer,i)=>{
   const id=group[i];
   if(answer.status==='rejected'){ errors.push(id+': '+answer.reason.message); return; }
   const endpoint=answer.value;
   catalog[id]=preferred(endpoint.timeseries.filter(s=>
    [ids.price,ids.load,ids.forecast].includes(s.name)||s.name.startsWith(ids.fuel)))
    .map(s=>({name:s.name,provider:s.provider,entity:id}));
   for(const relation of endpoint.relations??[]){
    if(!relation.id.startsWith('border:')) continue;
    const [a,b]=relation.id.slice(7).split('~');
    if(!a||!b) continue;
    catalog[relation.id]=preferred(relation.timeseries.filter(s=>s.name===ids.flow))
      .map(s=>({name:s.name,provider:s.provider,entity:relation.id}));
    if(!catalog[relation.id].length) delete catalog[relation.id];
   }
  });
 }
 return {catalog,errors,marketIds};
}
async function batch(series,start,end,apiKey){
 const results=[];
 const body={start,end,series};
 let cursor;
 do {
  const page=await rebase('/timeseries/values',cursor?{...body,cursor}:body,apiKey);
  if(!Array.isArray(page.series)) throw new Error('Unexpected Rebase values response');
  results.push(...page.series);
  if(cursor && cursor===page.next) throw new Error('Rebase returned a repeated cursor');
  cursor=page.next;
 } while(cursor);
 return results.map(s=>({...s,points:s.points?.sort((a,b)=>Date.parse(a.valid_time)-Date.parse(b.valid_time))}));
}
async function fxRates(series,start,end){
 const currencies=[...new Set(series.filter(s=>s.name===ids.price)
  .map(s=>/^([A-Z]{3})\/MWh$/.exec(s.unit??'')?.[1]).filter(code=>code&&code!=='EUR'))];
 if(!currencies.length) return {};
 const date=ms=>new Date(ms).toISOString().slice(0,10);
 const response=await fetch('https://api.frankfurter.dev/v1/'+date(start-7*24*hour)+'..'+date(end)+
  '?base=EUR&symbols='+currencies.join(','),{signal:AbortSignal.timeout(8000)});
 if(!response.ok) throw new Error('FX HTTP '+response.status);
 const {rates}=await response.json();
 const sorted=Object.keys(rates??{}).sort();
 const result={};
 for(let t=start;t<=end+24*hour;t+=24*hour){
  const day=date(t);
  const previous=sorted.findLast(d=>d<=day);
  if(previous) result[day]=rates[previous];
 }
 return result;
}
export async function dashboard(time,live,zone,partition,apiKey=key(),includeHistory=true){
 const requestTime=live?Math.floor(time/(5*minute))*5*minute:time;
 return cache('dashboard:'+requestTime+':'+live+':'+(apiKey&&partition===undefined?'all':zone)+':'+partition+':'+includeHistory,live?5*minute:hour,async()=>{
  const {catalog,errors,marketIds}=await discover(zone,partition,apiKey);
  if(!Object.keys(catalog).length) throw new Error(errors[0]??'No supported Rebase series discovered');
  let request=Object.values(catalog).flat();
  if(!apiKey && request.length>5){
   errors.push('Public access reads the selected zone, up to 5 series per bulk request. Add your key for all-zone coverage.');
   request=request.slice(0,5);
  }
  const from=requestTime-25*hour;
  const end=new Date(requestTime+minute).toISOString();
  const history=partition===undefined||!includeHistory?[]:request.filter(({entity})=>
   entity===zone||(entity.startsWith('border:')&&entity.slice(7).split('~').includes(zone)));
  const historicEntries=new Set(history);
  const mapSeries=request.filter(item=>!historicEntries.has(item));
  const series=[];
  if(mapSeries.length) series.push(...await batch(mapSeries,
   new Date(partition===undefined?from:requestTime-4*hour).toISOString(),end,apiKey));
  if(history.length) series.push(...await batch(history,new Date(from).toISOString(),end,apiKey));
  const rejected=series.filter(s=>s.error);
  if(rejected.length) errors.push(rejected.length+' series returned upstream errors.');
  const missing=request.length-series.length;
  if(missing>0) errors.push(missing+' requested series were absent from the response.');
  const rates=await fxRates(series,from,requestTime).catch(()=>{
   errors.push('Currency conversion unavailable for non-EUR prices.');
   return {};
  });
  const normalized=snapshot(series,catalog,requestTime,live,rates);
  return {mode:'rebase',time:requestTime,marketIds,errors,...normalized,series,catalog,rates,
   attribution:[...new Set(series.flatMap(s=>s.licence?.name?[s.licence.name]:[]))]};
 });
}

