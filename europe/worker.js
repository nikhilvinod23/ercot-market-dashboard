import {dashboard} from './rebase.js';
import {zones,hour} from './zones.js';

const origin='https://nikhilvinod23.github.io';
const schedules=['7 * * * *','17 * * * *','27 * * * *'];

function archiveKey(time,partition){
 const iso=new Date(time).toISOString();
 return 'europe/observations/'+iso.slice(0,10).replaceAll('-','/')+'/'+iso.slice(11,13)+'/'+partition+'.json.gz';
}

async function preserve(event,env){
 const partition=schedules.indexOf(event.cron);
 if(partition<0) throw new Error('Unexpected European archive schedule.');
 if(!env.REBASE_API_KEY) throw new Error('Rebase key required for European archive.');
 const time=Math.floor(event.scheduledTime/hour)*hour;
 const key=archiveKey(time,partition);
 if(await env.MARKET_ARCHIVE.head(key)) return;
 const data=await dashboard(time,true,'DE-LU',partition);
 const series=data.series.filter(item=>!item.error).map(item=>({...item,
  points:item.points?.filter(point=>Date.parse(point.valid_time)>time-2*hour)
 }));
 const record={...data,series,collectedAt:new Date().toISOString()};
 const compressed=new Blob([JSON.stringify(record)]).stream().pipeThrough(new CompressionStream('gzip'));
 await env.MARKET_ARCHIVE.put(key,compressed,{
  onlyIf:{etagDoesNotMatch:'*'},
  httpMetadata:{contentType:'application/json',contentEncoding:'gzip'}
 });
}

export default {
 async scheduled(event,env){
  await preserve(event,env);
 },
 async fetch(request,env){
  const url=new URL(request.url);
  const headers={'Access-Control-Allow-Origin':origin,'Cache-Control':'no-store'};
  const reject=(error,status)=>Response.json({error},{status,headers});
  if(request.method!=='GET'||url.pathname!=='/api/dashboard') return reject('Route unavailable.',404);
  if(request.headers.get('Origin')!==origin) return reject('Origin unavailable.',403);
  if(!env.REBASE_API_KEY) return reject('Rebase is awaiting configuration.',503);
  const zone=url.searchParams.get('zone')??'DE-LU';
  const partition=url.searchParams.get('partition');
  const at=url.searchParams.get('at');
  const time=at?Date.parse(at):Date.now();
  if(!Object.hasOwn(zones,zone)||!['0','1','2'].includes(partition)||!Number.isFinite(time)||time>Date.now()+24*hour)
   return reject('Invalid market zone or delivery time.',400);
  try{
   const data=await dashboard(time,!at,zone,Number(partition));
   const include=id=>id===zone||(id.startsWith('border:')&&id.slice(7).split('~').includes(zone));
   return Response.json({...data,
    series:data.series.filter(series=>include(series.entity)),
    catalog:Object.fromEntries(Object.entries(data.catalog).filter(([id])=>include(id)))
   },{headers});
  }catch{
   return reject('Rebase data could not be retrieved. Try again shortly.',502);
  }
 }
};
