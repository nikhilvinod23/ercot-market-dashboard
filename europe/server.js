import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {dashboard} from './rebase.js';
import {demo} from './demo.js';
import {zones,hour} from './zones.js';

const files={'/':'index.html','/app.js':'app.js','/map.js':'map.js','/market.js':'market.js','/zones.js':'zones.js','/styles.css':'styles.css','/public-api.js':'public-api.js','/demo.js':'demo.js'};
const content={'html':'text/html','js':'text/javascript','css':'text/css','json':'application/json'};
function send(res,code,body,type='application/json'){
 res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(type==='application/json'?JSON.stringify(body):body);
}
export async function handleRequest(req,res){
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET') return send(res,405,{error:'GET required'});
  if(files[url.pathname]){
   const file=files[url.pathname];
   return send(res,200,await readFile(new URL(file,import.meta.url)),content[file.split('.').at(-1)]);
  }
  if(url.pathname==='/boundaries.json'){
   try {return send(res,200,JSON.parse(await readFile(new URL('boundaries.json',import.meta.url),'utf8')));}
   catch {return send(res,404,{error:'Local boundary bundle unavailable'});}
  }
  if(url.pathname!=='/api/dashboard') return send(res,404,{error:'Unknown path'});
  const mode=url.searchParams.get('mode')??'rebase';
  const zone=url.searchParams.get('zone')??'DE-LU';
  const date=url.searchParams.get('at');
  const time=date?Date.parse(date):Date.now();
  if(!Object.hasOwn(zones,zone)||!['demo','rebase'].includes(mode)||!Number.isFinite(time)||time>Date.now()+24*hour)
   return send(res,400,{error:'Invalid zone, mode or delivery time'});
  const data=mode==='demo'?demo(time,!date):await dashboard(time,!date,zone);
  // The selected zone only needs its own history, plus the incident border series.
  const history=data.series.filter(s=>s.entity===zone ||
   (s.entity.startsWith('border:') && s.entity.slice(7).split('~').includes(zone)));
  const catalog=Object.fromEntries(Object.entries(data.catalog).filter(([id])=>id===zone||(id.startsWith('border:')&&id.slice(7).split('~').includes(zone))));
  return send(res,200,{...data,series:history,catalog});
 }catch(error){return send(res,502,{error:error.cause?.code==='ENOTFOUND'?'Rebase host could not be resolved from the server.':error.message});}
}
const server=http.createServer(handleRequest);
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) server.listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.info('European Power Markets · http://127.0.0.1:'+server.address().port));




