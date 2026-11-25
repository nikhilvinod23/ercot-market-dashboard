import {zones,ids,hour} from './zones.js';
import {snapshot} from './market.js';

const links=[
 ['PT','ES'],['ES','FR'],['FR','GB'],['GB','SEM'],['FR','BE'],['FR','DE-LU'],['FR','CH'],['FR','IT-NO'],
 ['BE','NL'],['NL','DE-LU'],['DE-LU','DK-DK1'],['DE-LU','DK-DK2'],['DE-LU','PL'],['DE-LU','AT'],
 ['AT','CH'],['AT','CZ'],['CZ','PL'],['HU','SK'],['HU','RO'],['RO','BG'],['BG','GR'],['HR','SI'],
 ['DK-DK1','DK-DK2'],['DK-DK1','NO-NO2'],['DK-DK2','SE-SE4'],['NO-NO1','NO-NO2'],['NO-NO1','NO-NO5'],
 ['NO-NO5','NO-NO3'],['NO-NO3','NO-NO4'],['NO-NO4','SE-SE1'],['SE-SE1','SE-SE2'],['SE-SE2','SE-SE3'],
 ['SE-SE3','SE-SE4'],['SE-SE3','FI'],['FI','EE'],['EE','LV'],['LV','LT'],['LT','PL'],
 ['IT-NO','IT-CNO'],['IT-CNO','IT-CSO'],['IT-CSO','IT-SO'],['IT-SO','IT-CAL'],['IT-CAL','IT-SIC'],
 ['IT-CSO','IT-SAR']
];
export function demo(at,live){
 const time=live?Math.floor(at/hour)*hour:at;
 const end=Math.floor(time/hour)*hour;
 const series=[];
 function add(entity,name,unit,value){
  const points=Array.from({length:26},(_,i)=>{
   const t=end-(25-i)*hour;
   return {valid_time:new Date(t).toISOString(),knowledge_time:null,value:Math.round(value(t/hour)*100)/100};
  });
  series.push({entity,name,provider:'synthetic',unit,resolution:'PT1H',points});
 }
 Object.keys(zones).forEach((zone,i)=>{
  const capacity=({'DE-LU':56000,FR:54000,ES:30000,GB:29000,PL:17000,'IT-NO':22000})[zone]??(800+i*143)%7100+800;
  const nordic=/^(NO|SE|FI)/.test(zone), thermal=/^(FR|FI|GB|SE)/.test(zone);
  const weights=nordic?[.3,.03,.05,thermal?.22:0,.45,.02]:[.28,.19,.31,thermal?.53:0,.11,.07];
  ['wind_onshore','solar','fossil_gas','nuclear','hydro_water_reservoir','biomass'].forEach((fuel,j)=>{
   if(!weights[j]) return;
   add(zone,ids.fuel+fuel,'MW',h=>capacity*weights[j]*(j===1?Math.max(0,Math.sin((h%24-6)*Math.PI/12)):1+.22*Math.sin(h*.13+j+i)));
  });
  add(zone,ids.load,'MW',h=>capacity*(1+.15*Math.sin(h*.25+i)));
  add(zone,ids.forecast,'MW',h=>capacity*(1+.13*Math.sin(h*.25+i+.1)));
  add(zone,ids.price,'EUR/MWh',h=>70+i%7*9+72*Math.sin(h*.17+i*.39));
 });
 links.forEach((pair,i)=>add('border:'+pair.sort().join('~'),ids.flow,'MW',h=>2350*Math.sin(h*.11+i)));
 const catalog=Object.groupBy(series,s=>s.entity);
 const rates={};
 return {mode:'demo',time,marketIds:Object.keys(zones),errors:[],...snapshot(series,catalog,time,live,rates),
  series,catalog,rates,attribution:['Synthetic demonstration data']};
}

