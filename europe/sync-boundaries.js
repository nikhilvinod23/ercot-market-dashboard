import {writeFile} from 'node:fs/promises';
import {boundaryIds,boundaryRoot,zones} from './zones.js';

const bundle={};
for(const id of boundaryIds){
 const url=boundaryRoot+zones[id].file+'.geojson';
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw new Error(id+' boundary HTTP '+response.status);
 bundle[id]=await response.json();
}
await writeFile('boundaries.json',JSON.stringify(bundle));
console.log('Saved '+Object.keys(bundle).length+' bidding-zone boundary files.');

