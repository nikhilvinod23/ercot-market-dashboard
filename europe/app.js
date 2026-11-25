import {publishedApi,publishedBuild} from './public-api.js';
import {demo} from './demo.js';
import {createMap,color,fuelName,palette,demandMaxGW,fuelGroup,generation} from './map.js';
import {zones,hour,minute} from './zones.js';
import {snapshot,exchange} from './market.js';

const $=id=>document.getElementById(id);
const number=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—';
const power=v=>Number.isFinite(v)?number(v/1000)+' GW':'—';
const price=v=>Number.isFinite(v)?'€'+number(v)+'/MWh':'—';
const utc=ms=>new Date(ms).toISOString().slice(0,16).replace('T',' ')+' UTC';
const local=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',dateStyle:'medium',timeStyle:'short'}).format(ms);
let active='', selectedLink=null, data=null, controller, requestId=0;
const filters={generation:true,demand:true,price:true,flow:false,selectedOnly:false,colorMode:'auto',heightMode:'auto',mixStyle:'pie',groupFuels:false};
const map=createMap($('map'),{zone:id=>selectZone(id===active?'':id),link:selectLink,geometry(count,total,done){
 $('geometry').textContent=count?count+' zone boundaries · Dashed markers have no polygon':
  done?'Boundary files unavailable · Market anchors only':'Fetching zone boundaries…';
}});
for(const [id,zone] of Object.entries(zones).sort((a,b)=>a[1].name.localeCompare(b[1].name)))
 $('zone').add(new Option(zone.name+' · '+id,id));
$('zone').value=active;
function selectZone(id){
 const changed=id!==active;

 active=id;selectedLink=null;$('zone').value=id;$('details').open=true;
 render();
 if(changed) refresh();
}
function selectLink(id){selectedLink=id;$('details').open=true;render();}
function timeInput(ms){$('delivery').value=new Date(ms).toISOString().slice(0,16);}
timeInput(Date.now());
function delivery(){return Date.parse($('delivery').value+'Z');}
function report(message,warning=false){
 $('status').textContent=message;$('status').classList.toggle('warn',warning);
}
async function loadDashboard(query,signal){
 if(publishedBuild&&query.get('mode')==='demo'){
  const at=query.get('at');
  return demo(at?Date.parse(at):Date.now(),!at);
 }
 if(publishedBuild&&!publishedApi) throw new Error('The published Rebase connection is awaiting configuration.');
 async function read(url){
  const response=await fetch(url,{signal});
  const payload=await response.json();
  if(!response.ok) throw new Error(payload.error??'Market data unavailable.');
  return payload;
 }
 if(!publishedBuild) return read('/api/dashboard?'+query);
 const results=await Promise.allSettled([0,1,2].map(partition=>{
  const url=new URL(publishedApi);
  url.search=new URLSearchParams([...query,['partition',partition]]).toString();
  return read(url);
 }));
 if(signal.aborted) throw signal.reason;
 const partitions=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
 const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(!partitions.length) throw failures[0];
 const flows=new Map(), series=new Map();
 for(const part of partitions){
  for(const flow of part.flows) if(flow.flow||!flows.has(flow.id)) flows.set(flow.id,flow);
  for(const entry of part.series) series.set(JSON.stringify([entry.entity,entry.name,entry.provider]),entry);
 }
 return {...partitions[0],
  zones:Object.assign({},...partitions.map(part=>part.zones)),
  catalog:Object.assign({},...partitions.map(part=>part.catalog)),
  rates:Object.assign({},...partitions.map(part=>part.rates)),
  flows:[...flows.values()],series:[...series.values()],
  errors:[...new Set([...partitions.flatMap(part=>part.errors),...failures.map(error=>error.message)])],
  attribution:[...new Set(partitions.flatMap(part=>part.attribution))]};
}
async function refresh(){
 const live=$('mode').value==='live', at=live?null:delivery();
 if(!live&&!Number.isFinite(at)){report('Choose a valid UTC delivery time.',true);return;}
 controller?.abort();
 controller=new AbortController();
 const seq=++requestId;
 const source=$('source').value;
 if(data && (data.mode!==source||data.historical===live||(!live&&data.time!==at))) data=null;
 render();
 report(source==='demo'?'Loading synthetic demo…':'Refreshing Rebase Grid…');
 $('timestamp').textContent='';
 try {
  const query=new URLSearchParams({mode:source,zone:active||'DE-LU'});
  if(at!==null) query.set('at',new Date(at).toISOString());
  const payload=await loadDashboard(query,controller.signal);
  if(seq!==requestId) return;

  data={...payload,historical:!live,selected:active};
  const title=source==='demo'?'Synthetic demo · illustrative values':live?'Rebase Grid · latest available':'Rebase Grid · historical';
  report(title+(payload.errors.length?' · partial response':''),source==='demo'||!!payload.errors.length);
  $('status').title=payload.errors.join('\n');
  if(live)timeInput(data.time);
  $('timestamp').textContent=utc(data.time);
  $('local').textContent=local(data.time)+' · Brussels delivery time';
  $('attribution').textContent=payload.attribution.length?' · '+payload.attribution.join(' · '):'';
  render();
 } catch(error) {
  if(seq!==requestId||error.name==='AbortError') return;
  report(error.message+(data?' · showing previous response':' · Synthetic demo available'),true);
  if(data) $('timestamp').textContent=utc(data.time);
  render();
 }
}
function add(parent,tag,text,cls){
 const e=document.createElement(tag);
 if(text!==undefined) e.textContent=text;
 if(cls)e.className=cls;
 parent.append(e);return e;
}
function metric(parent,label,value,note){
 const box=add(parent,'div',undefined,'metric');
 add(box,'span',label);add(box,'strong',value);if(note)add(box,'small',note);
 return box;
}
function stamp(obs){
 if(!obs)return 'Unavailable';
 return new Date(obs.time).toISOString().slice(11,16)+' UTC'+(obs.stale?' · stale':'')+
  (obs.provider&&obs.provider!=='synthetic'?' · '+obs.provider:'');
}
function provenance(element,obs){
 if(obs) element.title='Delivery: '+utc(Date.parse(obs.time))+'\nPublication: '+
  (obs.published?utc(Date.parse(obs.published)):'unavailable')+(obs.annotation?'\nAnnotation: '+obs.annotation:'')+
  (obs.originalUnit&&obs.originalUnit!=='EUR/MWh'?'\nOriginal: '+obs.originalValue+' '+obs.originalUnit:'');
}
function chart(panel,title,lines,rows,unit,start,end){
 add(panel,'h3',title);
 const values=rows.flatMap(r=>lines.map(l=>r[l.key])).filter(Number.isFinite);
 if(!values.length){add(panel,'p','No aligned observations in this window.','muted');return;}
 const min=Math.min(...values),max=Math.max(...values);
 const range=max-min||1, low=min-range*.1,high=max+range*.1;
 const root=add(panel,'div',undefined,'graph');
 const key=add(root,'div',undefined,'chart-key');
 for(const line of lines){const label=add(key,'span');add(label,'i').style.background=line.color;label.append(line.name);}
 const ns='http://www.w3.org/2000/svg';
 const make=(tag,attrs,t)=>{
  const item=document.createElementNS(ns,tag);
  for(const [k,v] of Object.entries(attrs))item.setAttribute(k,v);
  if(t!==undefined)item.textContent=t;
  return item;
 };
 const image=make('svg',{viewBox:'0 0 300 93',role:'img','aria-label':title+' over 24 hours, '+unit});
 for(const y of [13,38,65]) image.append(make('line',{x1:43,y1:y,x2:289,y2:y,stroke:'#283749'}));
 const anchor=(x,y,t)=>image.append(make('text',{x,y,fill:'#a5b7ca','font-size':9},t));
 anchor(4,15,number(high,1));anchor(4,67,number(low,1));anchor(4,87,unit);
 anchor(45,85,utc(start).slice(11,16));anchor(258,85,utc(end).slice(11,16));
 for(const line of lines){
  let path='',previous=false;
  for(const row of rows){
   if(!Number.isFinite(row[line.key])){previous=false;continue;}
   const x=43+(row.at-start)/(end-start)*246;
   const y=65-(row[line.key]-low)/(high-low)*52;
   path+=(previous?' L':' M')+x+' '+y;
   previous=true;
  }
  image.append(make('path',{d:path,fill:'none',stroke:line.color,'stroke-width':1.6}));
 }
 root.append(image);
}
function renderLink(panel,link){
 const value=link.flow?.value;
 const [from,to]=value<0?[link.b,link.a]:[link.a,link.b];
 add(panel,'div','Physical interconnection','eyebrow');
 add(panel,'h2',from+(value===0?' ↔ ':' → ')+to);
 const metrics=add(panel,'div',undefined,'metrics');
 provenance(metric(metrics,'Net physical flow',power(Math.abs(value)),stamp(link.flow)),link.flow);
 const at=Date.parse(link.flow?.time);
 const a=data.zones[from]?.price,b=data.zones[to]?.price;
 // Exact snapshot spread is available only when both delivery intervals cover the flow timestamp.
 const sameInterval=Number.isFinite(at)&&a&&b&&[a,b].every(p=>at>=Date.parse(p.time)&&at<Date.parse(p.time)+p.interval);
 metric(metrics,'Destination − origin',price(sameInterval?b.value-a.value:null),sameInterval?'Aligned day-ahead prices':'Aligned prices unavailable');
 add(panel,'p','Physical measurements · Scheduled exchanges and available capacity are separate products.','muted');
 add(panel,'button',(active?'Back to '+active:'Back to Europe')).addEventListener('click',()=>{selectedLink=null;render();});
}
const expandedFuels=new Set();
function fuelRow(row,fuel,obs,share){
 add(row,'i').style.background=color(fuel);
 add(row,'span',fuelName(fuel));
 add(row,'span',power(obs.value)+' · '+number(share,1)+'%');
 if(obs.time) provenance(row,obs);
}
function renderMix(panel,mix){
 add(panel,'h3','Generation by fuel');
 const fuels=generation({mix},filters.groupFuels);
 const total=fuels.reduce((sum,[,obs])=>sum+obs.value,0);
 if(!total){add(panel,'p','No positive generation observations available.','muted');return;}
 if(mix.partial)add(panel,'p','Some fuels are missing. Shares use reported positive generation.','notice');
 const subtypes=filters.groupFuels?Map.groupBy(generation({mix}),([fuel])=>fuelGroup(fuel)):new Map();
 const ring=add(panel,'div',undefined,'fuel-ring');
 add(ring,'span',power(total));
 let offset=0;
 const segments=[];
 for(const [fuel,obs] of fuels){
  const share=100*obs.value/total;
  segments.push(color(fuel)+' '+offset+'% '+(offset+share)+'%');
  offset+=share;
  const members=subtypes.get(fuel)??[];
  if(members.length>1||members.some(([type])=>type!==fuel)){
   const details=add(panel,'details',undefined,'fuel-group');
   details.open=expandedFuels.has(fuel);
   details.addEventListener('toggle',()=>{
    if(!details.isConnected) return;
    if(details.open) expandedFuels.add(fuel);
    else expandedFuels.delete(fuel);
   });
   fuelRow(add(details,'summary',undefined,'fuelrow'),fuel,obs,share);
   const list=add(details,'div',undefined,'fuel-subtypes');
   for(const [type,output] of members)
    fuelRow(add(list,'div',undefined,'fuelrow'),type,output,100*output.value/total);
  }else fuelRow(add(panel,'div',undefined,'fuelrow'),fuel,obs,share);
 }
 ring.style.background='conic-gradient('+segments.join(',')+')';
}
function renderEurope(panel){
 add(panel,'h2','Europe');
 if(filters.generation){
  const observed=Object.values(data?.zones??{}).flatMap(zone=>zone.mix?.fuels.map(([fuel])=>fuel)??[]);
  const key=add(panel,'div',undefined,'generation-key');
  add(key,'h3','Generation color key');
  const entries=add(key,'div',undefined,'key-items');
  for(const fuel of [...new Set((observed.length?observed:Object.keys(palette)).map(fuel=>filters.groupFuels?fuelGroup(fuel):fuel))].sort((a,b)=>fuelName(a).localeCompare(fuelName(b)))){
   const row=add(entries,'div',undefined,'key-item');
   add(row,'i').style.background=color(fuel);
   add(row,'span',fuelName(fuel));
  }
 }
 if(!data){add(panel,'p','Waiting for market data.','muted');return;}
 const totals=new Map();
 const mixes=Object.values(data.zones).map(zone=>zone.mix).filter(mix=>mix&&!mix.stale);
 for(const mix of mixes) for(const [fuel,obs] of mix.fuels){
  if(obs.value>0) totals.set(fuel,(totals.get(fuel)??0)+obs.value);
 }
 add(panel,'p',mixes.length+' of '+data.marketIds.length+' bidding zones reporting current generation.','muted');
 for(const error of data.errors.slice(0,3)) add(panel,'p',error,'notice');
 renderMix(panel,{partial:mixes.some(mix=>mix.partial),
  fuels:[...totals].sort((a,b)=>b[1]-a[1]).map(([fuel,value])=>[fuel,{value}])});
}
function render(){
 for(const [id,key] of [['surface-color','colorMode'],['surface-height','heightMode']]){
  const control=$(id);
  for(const option of control.options){
   option.disabled=Object.hasOwn(filters,option.value)&&!filters[option.value];
  }
  if(control.selectedOptions[0]?.disabled) control.value=filters[key]='auto';
 }
 const autoColor=(active?['generation','demand','price']:['price','generation','demand']).find(key=>filters[key])??'none';
 const autoHeight=['demand','generation','price'].find(key=>filters[key])??'none';
 const colorMode=filters.colorMode==='auto'?autoColor:filters.colorMode;
 const heightMode=filters.heightMode==='auto'?autoHeight:filters.heightMode;
 $('group-fuels').disabled=!filters.generation;
 $('mix-style').disabled=colorMode!=='generation';
 map.update(data,{...filters,colorMode,heightMode},active,selectedLink);
 $('price-legend').hidden=colorMode!=='price'&&heightMode!=='price';
 $('demand-legend').hidden=colorMode!=='demand';
 $('demand-legend').querySelector('.legend-scale').lastElementChild.textContent=demandMaxGW+'+';
 $('map-legend').hidden=$('price-legend').hidden&&$('demand-legend').hidden;
 $('price-height').hidden=heightMode!=='price';
 const panel=$('panel');panel.replaceChildren();
 if(filters.flow){
  const key=add(panel,'div',undefined,'flow-key');
  add(key,'span','Physical flows');
  if(active){
   add(key,'span','Outgoing','flow-out');
   add(key,'span','Incoming','flow-in');
  }else add(key,'span','Blue to amber · 0 to 5+ GW','flow-range');
 }
 const link=data?.flows.find(f=>f.id===selectedLink);
 if(link){renderLink(panel,link);return;}
 if(!active){renderEurope(panel);return;}
 add(panel,'div',active,'eyebrow');add(panel,'h2',zones[active].name);
 const info=data?.zones[active]??{};
 const metrics=add(panel,'div',undefined,'metrics');
 provenance(metric(metrics,'Day-ahead auction',price(info.price?.value),stamp(info.price)),info.price);
 provenance(metric(metrics,'Actual demand',power(info.load?.value),stamp(info.load)),info.load);
 metric(metrics,info.mix?.partial?'Reported generation':'Total generation',power(info.mix?.total),stamp(info.mix));
 provenance(metric(metrics,'Day-ahead load forecast',power(info.forecast?.value),stamp(info.forecast)),info.forecast);
 const net=exchange(data?.flows??[],active,info.load);
 metric(metrics,'Physical imports',power(net.seen?net.imports:null),net.seen+' / '+net.expected+' aligned links');
 metric(metrics,'Physical exports',power(net.seen?net.exports:null),net.seen+' / '+net.expected+' aligned links');
 metric(metrics,'Net import dependence',net.dependence===null?'—':number(net.dependence*100,1)+'%','Net imports ÷ actual demand');
 if(data?.errors.length)for(const error of data.errors.slice(0,3))add(panel,'p',error,'notice');
 renderMix(panel,info.mix);
 if(!data)return;
 const links=data.flows.filter(f=>f.flow && (f.a===active||f.b===active));
 if(links.length){
  const list=add(panel,'div',undefined,'linklist');
  for(const link of links) add(list,'button',link.a===active?link.b:link.a).addEventListener('click',()=>selectLink(link.id));
 }
 if(data.selected!==active){add(panel,'p','Loading selected zone history…','muted');return;}
 const end=Math.floor(data.time/(15*minute))*15*minute,start=end-24*hour;
 const rows=Array.from({length:97},(_,i)=>{
  const at=start+i*15*minute;
  const point=snapshot(data.series,data.catalog,at,false,data.rates);
  const zone=point.zones[active], flow=exchange(point.flows,active,zone?.load);
  return {at,generation:zone?.mix&&!zone.mix.partial?zone.mix.total/1000:null,load:zone?.load?zone.load.value/1000:null,
   price:zone?.price?.value,net:flow.seen&&flow.seen===flow.expected?flow.net/1000:null};
 });
 chart(panel,'Generation and demand · 24h',[{key:'generation',name:'Generation',color:'#62dfaa'},{key:'load',name:'Demand',color:'#66bafa'}],rows,'GW',start,end);
 chart(panel,'Day-ahead auction · 24h',[{key:'price',name:'Price',color:'#e2ba6e'}],rows,'€/MWh',start,end);
 chart(panel,'Net physical exchange · 24h',[{key:'net',name:'Net imports',color:'#ae9af8'}],rows,'GW',start,end);
}
$('zone').addEventListener('change',e=>selectZone(e.target.value));
for(const input of document.querySelectorAll('[data-layer]'))input.addEventListener('change',e=>{filters[e.target.dataset.layer]=e.target.checked;render();});
$('source').addEventListener('change',refresh);$('mode').addEventListener('change',refresh);
$('refresh').addEventListener('click',refresh);
$('apply').addEventListener('click',()=>{$('mode').value='historical';refresh();});
for(const [id,direction] of [['back',-1],['forward',1]])
 $(id).addEventListener('click',()=>{timeInput((delivery()||Date.now())+direction*hour);$('mode').value='historical';refresh();});
for(const [id,key] of [['surface-color','colorMode'],['surface-height','heightMode'],['mix-style','mixStyle']])
 $(id).addEventListener('change',e=>{filters[key]=e.target.value;render();});
for(const [id,action] of [['plus',()=>map.zoom(1.25)],['minus',()=>map.zoom(.8)],['reset',()=>{if(active||selectedLink)selectZone('');else map.reset();}]]) $(id).addEventListener('click',action);
if(new URLSearchParams(location.search).get('mode')==='demo') $('source').value='demo';
setInterval(()=>{if($('mode').value==='live')refresh();},5*minute);
refresh();


