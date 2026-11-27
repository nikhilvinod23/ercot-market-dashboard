import {zones,boundaryIds,boundaryRoot} from './zones.js';

const namespace='http://www.w3.org/2000/svg';
export const palette={
 wind:'#52dbaf',hydro:'#4185ef',coal:'#9aa9bb',oil:'#c69571',
 wind_onshore:'#52dbaf',wind_offshore:'#51acfa',solar:'#ffcf59',nuclear:'#bc96ff',
 fossil_gas:'#ff985c',fossil_hard_coal:'#9aa9bb',fossil_brown_coal_lignite:'#b4826b',
 hydro_water_reservoir:'#4ce8f1',hydro_run_of_river_and_poundage:'#4185ef',
 hydro_pumped_storage:'#6b74ff',biomass:'#a9ce65',waste:'#b8ae79',other:'#adb8ca'
};
export const color=key=>palette[key]??('hsl('+([...key].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%360)+' 57% 66%)');
export const fuelName=key=>({fossil_brown_coal_lignite:'Lignite',fossil_hard_coal:'Hard coal',fossil_gas:'Natural gas',
 hydro_pumped_storage:'Pumped storage output',hydro_run_of_river_and_poundage:'Run-of-river hydro',
 hydro_water_reservoir:'Reservoir hydro'})[key]??key.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());

function svg(tag,attrs,parent,text){
 const element=document.createElementNS(namespace,tag);
 for(const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
 if(text!==undefined) element.textContent=text;
 if(parent) parent.append(element);
 return element;
}
function priceColor(value){
 if(!Number.isFinite(value)) return '#151515';
 const stops=[[-80,[57,62,167]],[0,[30,86,121]],[50,[38,108,109]],[100,[115,111,66]],[200,[167,66,58]]];
 if(value<=stops[0][0]) return 'rgb('+stops[0][1]+')';
 const k=stops.findIndex(([limit])=>value<=limit);
 if(k<0) return 'rgb('+stops.at(-1)[1]+')';
 const [a,c]=stops[k-1], [b,d]=stops[k];
 return 'rgb('+c.map((channel,i)=>Math.round(channel+(d[i]-channel)*(value-a)/(b-a)))+')';
}
const fuelGroups=[
 ['wind',/^(?:wind)(?:_|$)/],
 ['hydro',/^hydro(?:_|$)/],
 ['solar',/^solar(?:_|$)/],
 ['nuclear',/^nuclear(?:_|$)/],
 ['fossil_gas',/^(?:fossil_gas|natural_gas)(?:_|$)/],
 ['coal',/^(?:fossil_(?:brown_coal|hard_coal|coal)|coal|lignite)(?:_|$)/],
 ['oil',/^(?:fossil_oil|oil)(?:_|$)/],
 ['biomass',/^biomass(?:_|$)/],
 ['geothermal',/^geothermal(?:_|$)/],
 ['waste',/^waste(?:_|$)/],
 ['marine',/^(?:marine|tidal|wave)(?:_|$)/]
];
export function fuelGroup(fuel){
 return fuelGroups.find(([,pattern])=>pattern.test(fuel))?.[0]??fuel;
}
export function generation(info,grouped=false){
 const fuels=info?.mix?.fuels.filter(([,obs])=>obs.value>0)??[];
 if(!grouped) return fuels;
 const totals=new Map();
 for(const [fuel,obs] of fuels){
  const group=fuelGroup(fuel);
  const previous=totals.get(group);
  totals.set(group,previous?{value:previous.value+obs.value}:obs);
 }
 return [...totals].sort((a,b)=>b[1].value-a[1].value);
}
function heightFor(info,mode){
 const values={price:()=>Math.abs(info?.price?.value)*.032,
  generation:()=>generation(info).reduce((sum,[,obs])=>sum+obs.value,0)/10000,
  demand:()=>info?.load?.value/10000};
 return Math.max(0,values[mode]?.()||0);
}
export const demandMaxGW=70;
const demandStops=[[24,38,70],[38,110,164],[134,222,255]];
function demandColor(value){
 if(!Number.isFinite(value)) return '#151515';
 const level=Math.max(0,Math.min(2,value/(demandMaxGW*500)));
 const low=Math.min(1,Math.floor(level)), fraction=level-low;
 return 'rgb('+demandStops[low].map((channel,i)=>Math.round(channel+(demandStops[low+1][i]-channel)*fraction))+')';
}
const fullTurn=2*Math.PI;
function fuelSectors(fuels){
 const total=fuels.reduce((sum,[,obs])=>sum+obs.value,0);
 let angle=0;
 return fuels.map(([fuel,obs])=>{
  const start=angle;
  angle+=fullTurn*obs.value/total;
  return {start,end:angle,fill:color(fuel)};
 });
}
function wallSections(a,b,center,sectors){
 if(sectors.length<2) return [[0,1,sectors[0]?.fill]];
 const dx=b[0]-a[0],dy=b[1]-a[1],x=a[0]-center[0],y=a[1]-center[1];
 const cuts=[0,1];
 for(const {start} of sectors){
  const rx=Math.sin(start),ry=-Math.cos(start);
  const cross=dx*ry-dy*rx;
  if(Math.abs(cross)<1e-9) continue;
  const t=(y*rx-x*ry)/cross;
  if(t>0&&t<1&&(x+dx*t)*rx+(y+dy*t)*ry>=0) cuts.push(t);
 }
 cuts.sort((a,b)=>a-b);
 return cuts.slice(1).map((end,i)=>{
  const start=cuts[i],mid=(start+end)/2;
  const angle=(Math.atan2(y+dy*mid,x+dx*mid)+Math.PI/2+fullTurn)%fullTurn;
  return [start,end,(sectors.find(sector=>angle<sector.end)??sectors.at(-1)).fill];
 });
}
function visibleWallOrder(rings,holeFlags){
 // Projected Y increases toward the viewer. Order overlapping edges by their
 // ground depth so the nearer wall covers every fuel band behind it.
 const edges=[];
 for(const [index,ring] of rings.entries()){
  let area=0;
  for(let i=1;i<ring.length;i++)
   area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];
  for(let i=1;i<ring.length;i++){
   let a=ring[i-1],b=ring[i];
   if((b[0]-a[0])*area*(holeFlags[index]?-1:1)>=0) continue;
   if(a[0]>b[0]) [a,b]=[b,a];
   edges.push({a,b,behind:[],drawn:false});
  }
 }
 edges.sort((first,second)=>first.a[0]-second.a[0]);
 let active=[];
 for(const edge of edges){
  active=active.filter(other=>other.b[0]>edge.a[0]);
  for(const other of active){
   const x=(edge.a[0]+Math.min(edge.b[0],other.b[0]))/2;
   const at=({a,b})=>a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
   if(at(edge)>at(other)) edge.behind.push(other);
   else other.behind.push(edge);
  }
  active.push(edge);
 }
 const ordered=[];
 for(const edge of edges){
  const pending=[{edge,ready:false}];
  while(pending.length){
   const next=pending.pop();
   if(next.ready){ordered.push(next.edge);continue;}
   if(next.edge.drawn) continue;
   next.edge.drawn=true;
   pending.push({edge:next.edge,ready:true});
   for(const behind of next.edge.behind) pending.push({edge:behind,ready:false});
  }
 }
 return ordered;
}
function drawStackedWalls(surface,edges,sectors,depth,width,height,pair,onClick){
 const left=Math.max(0,Math.floor(edges.reduce((min,{a})=>Math.min(min,a[0]),Infinity)));
 const right=Math.min(width,Math.ceil(edges.reduce((max,{b})=>Math.max(max,b[0]),-Infinity)));
 const top=Math.max(0,Math.floor(edges.reduce((min,{a,b})=>Math.min(min,a[1],b[1]),Infinity)));
 const bottom=Math.min(height,Math.ceil(edges.reduce((max,{a,b})=>Math.max(max,a[1],b[1]),-Infinity)+depth));
 if(right<=left||bottom<=top) return;
 const image=svg('foreignObject',{x:left,y:top,width:right-left,height:bottom-top,'pointer-events':'none'},surface);
 const canvas=document.createElement('canvas');
 canvas.width=right-left;
 canvas.height=bottom-top;
 image.append(canvas);
 const context=canvas.getContext('2d');
 if(!context){image.remove();return;}
 context.translate(-left,-top);
 const bandDepths=sectors.map(({start,end,fill})=>({start:depth*start/fullTurn,end:depth*end/fullTurn,fill}));
 const hit=[];
 for(const {a,b} of edges){
  if(b[0]<left||a[0]>right||Math.min(a[1],b[1])>bottom||Math.max(a[1],b[1])+depth<top) continue;
  for(const {start,end,fill} of bandDepths){
   context.fillStyle=fill;
   context.beginPath();
   context.moveTo(a[0],a[1]+start);
   context.lineTo(b[0],b[1]+start);
   context.lineTo(b[0],b[1]+end);
   context.lineTo(a[0],a[1]+end);
   context.closePath();
   context.fill();
  }
  hit.push('M'+pair(a)+' L'+pair(b)+' L'+pair([b[0],b[1]+depth])+' L'+pair([a[0],a[1]+depth])+' Z');
 }
 context.globalCompositeOperation='source-atop';
 context.fillStyle='rgba(0,0,0,.2)';
 context.fillRect(left,top,canvas.width,canvas.height);
 const target=svg('path',{d:hit.join(' '),fill:'transparent',class:'zone-wall'},surface);
 target.addEventListener('click',onClick);
}
function fillMix(parent,outline,id,center,radius,sectors){
 if(!sectors.length) return;
 if(sectors.length===1){
  svg('path',{d:outline,fill:sectors[0].fill,'fill-rule':'evenodd'},parent);
  return;
 }
 const clip=svg('clipPath',{id:'fuel-surface-'+id},parent);
 svg('path',{d:outline,'clip-rule':'evenodd'},clip);
 const slices=svg('g',{'clip-path':'url(#fuel-surface-'+id+')'},parent);
 const [x,y]=center;
 const at=angle=>[x+radius*Math.sin(angle),y-radius*Math.cos(angle)].join(',');
 for(const {start,end,fill} of sectors){
  svg('path',{d:'M'+center.join(',')+' L'+at(start)+' A'+radius+','+radius+' 0 '+(end-start>Math.PI?1:0)+' 1 '+at(end)+' Z',fill},slices);
 }
}
function simplify(ring){
 return ring.filter((p,i)=>i===0||i===ring.length-1||Math.hypot(p[0]-ring[i-1][0],p[1]-ring[i-1][1])>.015);
}
function polygons(data){
 const features=data.type==='FeatureCollection'?data.features:[data];
 return features.flatMap(feature=>{
  const g=feature.geometry??feature;
  const shapes=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return shapes.map(p=>p.map(simplify)).filter(p=>p[0]?.length>=4);
 });
}
const countryFallback={GB:['GBR'],SEM:['IRL','GBR'],AL:['ALB'],BA:['BIH'],MK:['MKD'],ME:['MNE'],XK:['XKX'],UA:['UKR'],MD:['MDA'],CY:['CYP'],TR:['TUR']};
async function loadBoundaries(onPart){
 const local=await fetch('./boundaries.json').then(r=>r.ok?r.json():null).catch(()=>null);
 const read=url=>fetch(url,{signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json():null).catch(()=>null);
 const countryFiles=new Map();
 function country(code){
  if(!countryFiles.has(code)) countryFiles.set(code,read('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/'+code+'.geo.json'));
  return countryFiles.get(code);
 }
 await Promise.all(Object.keys(zones).map(async id=>{
  const boundary=local?.[id]??(boundaryIds.includes(id)?await read(boundaryRoot+zones[id].file+'.geojson'):null);
  let geometry=boundary?polygons(boundary):[];
  if(!geometry.length&&countryFallback[id]){
   const parts=await Promise.all(countryFallback[id].map(async code=>{
    const data=await country(code);
    if(!data) return [];
    return polygons(data).filter(([ring])=>{
     if(code!=='GBR') return true;
     const northernIreland=ring.every(([lon,lat])=>lon< -5.25&&lat>53.7&&lat<55.5);
     return id==='SEM'?northernIreland:!northernIreland;
    });
   }));
   geometry=parts.flat();
  }
  if(geometry.length) onPart(id,geometry);
 }));
}

export function createMap(root,callbacks){
 const scene=svg('svg',{role:'group','aria-label':'Interactive perspective map of European electricity bidding zones'},root);
 const shapes={},camera={x:0,y:0,zoom:1};
 const markets=Object.entries(zones).sort((a,b)=>b[1].position[1]-a[1].position[1]);
 const wallOrders=new WeakMap();
 const layer={}; let data,flags,selected,selectedLink,frame=0,width=0,height=0,drag;
 const merc=l=>Math.log(Math.tan(Math.PI/4+l*Math.PI/360))*180/Math.PI;
 const latitudes=new Map();
 let baseScale, centerX, centerY, originX, originY, view, animation, needsFit=true, animateFit=false;
 const pitch=38*Math.PI/180;
 const tilt=Math.cos(pitch), rise=Math.sin(pitch);
 const plane=([lon,lat],elevation)=>[lon*.69,-(latitudes.get(lat)??merc(lat))*.64*tilt-elevation*rise];
 function project(position,elevation=0){
  const [x,y]=plane(position,elevation);
  return [originX+(x-centerX)*baseScale,originY+(y-centerY)*baseScale];
 }
 const elevationFor=id=>!selected||id===selected?heightFor(data?.zones[id],flags?.heightMode):0;
 function fit(){
  const vertices=selected?(shapes[selected]?.flat(2)??[zones[selected].position]):[];
  const positions=selected?vertices:[[-11,33],[44,72],...markets.map(([,zone])=>zone.position)];
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  const include=(position,elevation)=>{
   const [x,y]=plane(position,elevation);
   bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
   bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
  };
  for(const position of positions){include(position,0);include(position,selected?elevationFor(selected):0);}
  if(!selected) for(const [id,zone] of markets) include(zone.position,elevationFor(id));
  const left=root.closest('.map-shell')?.clientWidth<=850?24:204;
  const x=(bounds[0]+bounds[2])/2,y=(bounds[1]+bounds[3])/2;
  const scale=Math.min(Math.max(1,width-left-58)/Math.max(2,bounds[2]-bounds[0]),
   Math.max(1,height-110)/Math.max(2,bounds[3]-bounds[1]),selected?115:Infinity);
  return {x,y,scale};
 }
 const pair=([x,y])=>x.toFixed(1)+','+y.toFixed(1);
 function schedule(){
  if(frame) return;
  frame=requestAnimationFrame(now=>{frame=0;draw(now);});
 }
 function draw(now){
  if(width!==root.clientWidth||height!==root.clientHeight) needsFit=true;
  width=root.clientWidth;height=root.clientHeight;
  if(!width||!height) return;
  if(needsFit){
   const target=fit();
   if(animateFit&&view&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
    const from={x:view.x-camera.x/baseScale,y:view.y-camera.y/baseScale,scale:baseScale};
    animation={from,target,start:now};
    view=from;
   }else{view=target;animation=null;}
   Object.assign(camera,{x:0,y:0,zoom:1});
   needsFit=animateFit=false;
  }
  if(animation){
   const {from,target,start}=animation;
   const t=Math.min(1,(now-start)/320), progress=t*t*(3-2*t);
   view={x:from.x+(target.x-from.x)*progress,y:from.y+(target.y-from.y)*progress,
    scale:from.scale*(target.scale/from.scale)**progress};
   if(t<1) schedule();else animation=null;
  }
  const left=root.closest('.map-shell')?.clientWidth<=850?24:204;
  originX=(width+left-30)/2+camera.x;
  originY=(height-18)/2+camera.y;
  centerX=view.x;centerY=view.y;baseScale=view.scale*camera.zoom;
  scene.setAttribute('viewBox','0 0 '+width+' '+height);
  scene.replaceChildren();
  for(const name of ['zones','flows','markers']) layer[name]=svg('g',{},scene);
  const ordered=selected?[...markets.filter(([id])=>id!==selected),markets.find(([id])=>id===selected)]:markets;
  for(const [id,zone] of ordered){
   if(!shapes[id]?.length) continue;
   const info=data?.zones[id];
   const elevation=elevationFor(id);
   const surface=svg('g',{opacity:selected&&id!==selected ? .24 : 1},layer.zones);
   const fuels=flags?.colorMode==='generation'&&(!selected||id===selected)?generation(info,flags.groupFuels):[];
   const stacked=flags?.mixStyle==='stacked'&&fuels.length>0;
   if(stacked) fuels.sort((a,b)=>b[1].value-a[1].value);
   const sectors=fuelSectors(fuels);
   const fill=stacked?sectors[0].fill:flags?.colorMode==='price'?priceColor(info?.price?.value):
    flags?.colorMode==='demand'?demandColor(info?.load?.value):'#151515';
   const center=project(zone.position,elevation);
   const rings=shapes[id].flat();
   const top=rings.map(ring=>ring.map(point=>project(point,elevation)));
   const outline=top.map(ring=>'M'+ring.map(pair).join(' L')+' Z').join(' ');
   if(elevation){
    const geometry=shapes[id];
    if(!wallOrders.has(geometry)){
     const holes=geometry.flatMap(polygon=>polygon.map((_,index)=>index>0));
     wallOrders.set(geometry,visibleWallOrder(rings.map(ring=>ring.map(point=>plane(point,0))),holes));
    }
    const wallPoint=([x,y])=>[originX+(x-centerX)*baseScale,originY+(y-centerY-elevation*rise)*baseScale];
    const edges=wallOrders.get(geometry).map(({a,b})=>({a:wallPoint(a),b:wallPoint(b)}));
    const depth=elevation*rise*baseScale;
    const onClick=()=>{if(!drag?.moved) callbacks.zone(id);};
    if(stacked) drawStackedWalls(surface,edges,sectors,depth,width,height,pair,onClick);
    else{
     const walls=[];
     const interpolate=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
     function addWall(a,b,start,end,wallColor){
      const corners=[[a[0],a[1]+start],[b[0],b[1]+start],[b[0],b[1]+end],[a[0],a[1]+end]];
      if(a[0]>b[0]) corners.reverse();
      if(walls.at(-1)?.fill!==wallColor) walls.push({fill:wallColor,paths:[]});
      walls.at(-1).paths.push('M'+corners.map(pair).join(' L')+' Z');
     }
     for(const {a,b} of edges){
       for(const [start,end,fuelColor] of wallSections(a,b,center,sectors)){
        const wallColor=fuelColor??(flags?.colorMode==='generation'||flags?.colorMode==='none'?'#454545':fill);
        addWall(interpolate(a,b,start),interpolate(a,b,end),0,depth,wallColor);
       }
     }
     for(const {fill:wallColor,paths} of walls){
      const wall=svg('path',{d:paths.join(' '),fill:wallColor,class:sectors.length?'zone-wall fuel-wall':'zone-wall shaded-wall'},surface);
      wall.addEventListener('click',onClick);
     }
    }
   }
   svg('path',{d:outline,'fill-rule':'evenodd',fill},surface);
   if(sectors.length&&!stacked){
    const [x,y]=center;
    let radius=1;
    for(const ring of top) for(const [px,py] of ring) radius=Math.max(radius,Math.hypot(px-x,py-y)+1);
    fillMix(surface,outline,id,center,radius,sectors);
   }
   const path=svg('path',{d:outline,'fill-rule':'evenodd',fill:'transparent',
    class:id===selected?'zone selected':'zone'},surface);
   path.addEventListener('click',()=>{if(!drag?.moved) callbacks.zone(id);});
   svg('title',{},path,zone.name);
  }
  if(flags?.flow) for(const link of data?.flows??[]){
   if(!link.flow?.value||!zones[link.a]||!zones[link.b]) continue;
   const [from,to]=link.flow.value>0?[link.a,link.b]:[link.b,link.a];
   if(flags.selectedOnly && selected && ![from,to].includes(selected)) continue;
   const start=zones[from].position,end=zones[to].position;
   const magnitude=Math.abs(link.flow.value), elevation=Math.min(5,.9+Math.sqrt(magnitude)/18);
   const route=t=>project([start[0]+t*(end[0]-start[0]),start[1]+t*(end[1]-start[1])],4*t*(1-t)*elevation);
   const points=Array.from({length:14},(_,i)=>route(i/13));
   const line='M'+points.map(pair).join(' L');
   const thick=.7+Math.min(7,magnitude/550);
   const intensity=Math.min(1,magnitude/5000);
   const flowColor=from===selected?'#38dd81':to===selected?'#ff5866':'hsl('+(211-173*intensity)+' 90% '+(47+18*intensity)+'%)';
   svg('path',{d:line,class:link.id===selectedLink?'flowline active':'flowline',
    style:'stroke:'+flowColor,'stroke-width':thick,opacity:link.flow.stale?.38:.84},layer.flows);
   const target=svg('path',{d:line,stroke:'transparent','stroke-width':Math.max(13,thick+7),fill:'none',class:'pick'},layer.flows);
   target.addEventListener('click',()=>{if(!drag?.moved) callbacks.link(link.id);});
   svg('title',{},target,from+' → '+to+' · '+Math.round(magnitude)+' MW');
   const [ax,ay]=route(.69),[bx,by]=route(.65);
   const angle=Math.atan2(ay-by,ax-bx)*180/Math.PI;
   svg('path',{d:'M 6 0 L -4 -4 L -4 4 Z',transform:'translate('+ax+' '+ay+') rotate('+angle+')',class:'arrow',style:'fill:'+flowColor},layer.flows);
   if(camera.zoom>1.35||link.id===selectedLink){
    const [px,py]=route(.42);
    svg('text',{x:px,y:py-6,class:'flow-label'},layer.flows,(magnitude/1000).toFixed(2)+' GW');
   }
  }
  for(const [id,zone] of markets){
   if(selected&&id!==selected) continue;
   const info=data?.zones[id];
   const elevation=elevationFor(id);
   const [x,y]=project(zone.position,elevation);
   if(elevation&&!shapes[id]?.length){
    svg('path',{d:'M'+pair(project(zone.position))+' L'+pair([x,y]),stroke:flags?.colorMode==='price'?priceColor(info?.price?.value):'#777',
     'stroke-width':5,class:'zone-wall'},layer.markers);
   }
   if(x<-60||x>width+60||y<-60||y>height+60) continue;
   const group=svg('g',{transform:'translate('+x+' '+y+')',class:'marker',tabindex:0,role:'button',
    'aria-label':'Select '+zone.name},layer.markers);
   group.addEventListener('click',()=>{if(!drag?.moved) callbacks.zone(id);});
   group.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();callbacks.zone(id);}});
   const mix=flags?.generation&&flags.colorMode!=='generation'?info?.mix:null;
   const positive=generation({mix},flags?.groupFuels);
   const total=positive.reduce((n,[,p])=>n+p.value,0);
   const radius=mix?Math.min(27,Math.max(8,Math.sqrt(total)*.11)):4;
   svg('circle',{r:radius+3,fill:'#080808',stroke:id===selected?'#e8f6ff':'#68778d','stroke-width':id===selected?2:1,
    'stroke-dasharray':shapes[id]?.length?'none':'2 2'},group);
   if(total>0){
    let offset=0;
    for(const [fuel,p] of positive){
     const segment=p.value/total;
     svg('circle',{r:radius,fill:'none',stroke:color(fuel),'stroke-width':Math.max(3,radius*.29),
      pathLength:1,'stroke-dasharray':segment+' '+(1-segment),'stroke-dashoffset':-offset,
      transform:'rotate(-90)',opacity:mix.stale?.55:1},group);
     offset+=segment;
    }
    if(radius>=12) svg('text',{y:3,class:'marker-value'},group,(mix.total/1000).toFixed(1));
   }
   const price=flags?.price&&info?.price?' · €'+info.price.value.toFixed(2):'';
   const load=flags?.demand&&info?.load?'↓ '+(info.load.value/1000).toFixed(1)+' GW'+(info.load.stale?'*':''):'';
   const dense=/^(IT-|DK-|BE|NL|CH|SI|SK|BA|ME|XK|HR|NO-NO[125])/.test(id);
   if(!dense||camera.zoom>1.23||id===selected){
    svg('text',{y:radius+15,class:'map-label'},group,id+price);
    if(load) svg('text',{y:radius+28,class:'load-label'},group,load);
   }
   svg('title',{},group,zone.name+(mix?' · '+(mix.total/1000).toFixed(2)+' GW generation':'')+(load?' · '+load:''));
  }
 }
 // Capture on first movement so normal clicks retain their original SVG targets.
 scene.addEventListener('pointerdown',e=>{
  if(e.button!==0) return;
  drag={x:e.clientX,y:e.clientY,dx:0,dy:0,id:e.pointerId,moved:false};
 });
 scene.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId||!e.buttons) return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.moved && Math.hypot(dx,dy)<4) return;
  if(!drag.moved) scene.setPointerCapture(e.pointerId);
  drag.moved=true; drag.x=e.clientX;drag.y=e.clientY;
  drag.dx+=dx;drag.dy+=dy;
  scene.style.transform='translate('+drag.dx+'px,'+drag.dy+'px)';
 });
 function finishPan(e){
  if(drag?.id!==e.pointerId) return;
  if(drag.moved){
   camera.x+=drag.dx;
   camera.y+=drag.dy;
   scene.style.transform='';
   schedule();
  }
  drag.id=null;
 }
 scene.addEventListener('pointerup',finishPan);
 scene.addEventListener('pointercancel',finishPan);
 scene.addEventListener('lostpointercapture',finishPan);
 scene.addEventListener('contextmenu',e=>e.preventDefault());
 function zoom(factor){camera.zoom=Math.max(.55,Math.min(7,camera.zoom*factor));schedule();}
 scene.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.001));},{passive:false});
 new ResizeObserver(schedule).observe(root);
 loadBoundaries((id,geometry)=>{
  shapes[id]=geometry;
  for(const polygon of geometry) for(const ring of polygon) for(const [,lat] of ring)
   if(!latitudes.has(lat)) latitudes.set(lat,merc(lat));
  if(id===selected){needsFit=true;animateFit=true;}
  callbacks.geometry(Object.keys(shapes).length,markets.length);schedule();
 })
  .then(()=>callbacks.geometry(Object.keys(shapes).length,markets.length,true));
 function reset(){
  needsFit=true;animateFit=true;
  schedule();
 }
 return {update(payload,options,zone,link){
  if(zone!==selected) reset();
  data=payload;flags=options;selected=zone;selectedLink=link;schedule();
 },zoom,reset};
}
