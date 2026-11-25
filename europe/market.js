import {ids,hour,minute} from './zones.js';

export function duration(resolution){
 const parts=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(resolution??'');
 return parts ? (+parts[1]||0)*hour+(+parts[2]||0)*minute+(+parts[3]||0)*1000 : 0;
}
export function observation(series,time,{carry=false,exact=false}={}){
 if(!series) return null;
 const point=series.points?.findLast(point=>Date.parse(point.valid_time)<=time);
 if(!point || !Number.isFinite(point.value)) return null;
 const age=time-Date.parse(point.valid_time);
 const following=series.points.find(item=>Date.parse(item.valid_time)>time);
 const gap=following ? Date.parse(following.valid_time)-Date.parse(point.valid_time) : 0;
 const interval=Math.max(duration(series.resolution),exact && gap===hour ? hour : 0,1);
 const stale=age>=interval;
 if((exact || !carry) && stale) return null;
 return {value:point.value,time:point.valid_time,published:point.knowledge_time??null,
  provider:series.provider,unit:series.unit,interval,stale,annotation:point.annotation??null};
}
export function normalized(obs,kind,rates={},time){
 if(!obs) return null;
 const unit=obs.unit?.trim();
 if(kind==='power') {
  const factor={MW:1,GW:1000,kW:.001}[unit];
  return factor ? {...obs,value:obs.value*factor,unit:'MW'} : null;
 }
 const currency=/^([A-Z]{3})\/MWh$/.exec(unit??'')?.[1];
 const fx=currency==='EUR' ? 1 : rates[new Date(time).toISOString().slice(0,10)]?.[currency];
 return fx>0 ? {...obs,value:obs.value/fx,unit:'EUR/MWh',originalValue:obs.value,originalUnit:unit} : null;
}
export function aggregateFuel(series,time,carry){
 const index=new Map();
 for(const s of series){
  for(const p of s.points??[]){
   const at=Date.parse(p.valid_time);
   if(at>time || !Number.isFinite(p.value)) continue;
   if(!index.has(at)) index.set(at,[]);
   index.get(at).push([s,p]);
  }
 }
 const times=[...index.keys()].sort((a,b)=>b-a);
 const eligible=times.filter(at=>carry||index.get(at).every(([s])=>time-at<Math.max(duration(s.resolution),1)));
 const chosen=eligible.find(at=>index.get(at).length===series.length)??eligible[0];
 if(chosen===undefined) return null;
 const fuels=index.get(chosen).map(([s,p])=>[s.name.slice(ids.fuel.length),normalized(observation(s,chosen), 'power')])
  .filter(([,p])=>p).sort((a,b)=>b[1].value-a[1].value);
 if(!fuels.length) return null;
 const stale=fuels.some(([name])=>time-chosen>=Math.max(duration(series.find(s=>s.name===ids.fuel+name)?.resolution),1));
 if(stale && !carry) return null;
 return {time:new Date(chosen).toISOString(),stale,partial:fuels.length!==series.length,
  total:fuels.reduce((sum,[,p])=>sum+p.value,0),fuels};
}
export function snapshot(series,catalog,time,live,rates){
 const byEntity=Object.groupBy(series,s=>s.entity);
 const result={zones:{},flows:[]};
 for(const [entity,expected] of Object.entries(catalog)){
  const values=byEntity[entity]??[];
  const lookup=(name,kind,options)=>normalized(observation(values.find(s=>s.name===name),time,options),kind,rates,time);
  if(entity.startsWith('border:')){
   const [a,b]=entity.slice(7).split('~');
   const flow=lookup(ids.flow,'power',{carry:live});
   result.flows.push({id:entity,a,b,flow});
   continue;
  }
  const fuels=expected.filter(s=>s.name.startsWith(ids.fuel)).map(s=>values.find(v=>v.name===s.name)??s);
  result.zones[entity]={price:lookup(ids.price,'price',{exact:true}),load:lookup(ids.load,'power',{carry:live}),
   forecast:lookup(ids.forecast,'power',{exact:true}),mix:aggregateFuel(fuels,time,live)};
 }
 return result;
}
export function exchange(flows,id,load){
 const links=flows.filter(f=>f.a===id||f.b===id);
 const aligned=links.filter(f=>f.flow && load && f.flow.time===load.time && !f.flow.stale && !load.stale);
 let imports=0,exports=0;
 for(const link of aligned){
  const incoming=link.flow.value*(link.b===id?1:-1);
  imports+=Math.max(0,incoming); exports+=Math.max(0,-incoming);
 }
 return {imports,exports,net:imports-exports,seen:aligned.length,expected:links.length,
  dependence:aligned.length>0 && aligned.length===links.length && load?.value>0 ? (imports-exports)/load.value : null};
}


