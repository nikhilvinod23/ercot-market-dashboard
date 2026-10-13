"""Official commodity benchmarks and resource-node price samples, stored in the same ledger."""
import json
import statistics
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xlrd
from pipeline.collect import ROOT, CT, numeric, parse, iso, interval_end, report

BENCHMARKS={
 'Henry Hub':('RNGWHHDd','$/MMBtu',1440),
 'US LNG export price':('N9133US3m','$/Mcf',43200),
 'US LNG export volume':('N9133US2m','million cubic feet',43200),
}
def fuel_type(code):
    code=str(code).upper()
    if code in {'CCGT90','CCLE90','SCGT90','SCLE90'}:return 'Natural Gas'
    return {'WIND':'Wind','PVGR':'Solar','CLLIG':'Coal and Lignite','NUC':'Nuclear','HYDRO':'Hydro','DSL':'Diesel','ESR':'Battery'}.get(code,'Other / unclassified')

def collect_benchmark(archive, name):
    code,unit,minutes=BENCHMARKS[name]
    url='https://www.eia.gov/dnav/ng/hist_xls/'+code+'.xls'
    req=urllib.request.Request(url,headers={'User-Agent':'ERCOTMarketDashboard (public research)'})
    with urllib.request.urlopen(req,timeout=35) as r:content=r.read()
    book=xlrd.open_workbook(file_contents=content);sheet=book.sheet_by_index(1);values=[]
    floor=datetime.now(timezone.utc).date()-timedelta(days=3*365)
    for i in range(3,sheet.nrows):
        date,value=sheet.cell_value(i,0),numeric(sheet.cell_value(i,1))
        if value is None or not isinstance(date,(int,float)):continue
        dt=xlrd.xldate_as_datetime(date,book.datemode).replace(tzinfo=timezone.utc)
        if dt.date()<floor:continue
        archive.add('commodity',name,'US',dt,minutes,'actual',value,url,unit=unit)
        values.append({'date':dt.date().isoformat(),'value':value})
    archive.raw(code,{'source':url,'unit':unit,'series':values})
    return len(values)

def collect_resource_prices(http,headers,archive,today,history_days):
    cache_path=archive.root/'resource-mapping.json'
    try:cache=json.loads(cache_path.read_text())
    except (OSError,ValueError):cache={}
    # Allow an additional two days beyond the disclosure lag for publication delays.
    target=today-timedelta(days=62)
    if cache.get('disclosure_day')!=target.isoformat():
        params={'deliveryDateFrom':target.isoformat(),'deliveryDateTo':target.isoformat()}
        rows=report(http,headers,archive,'np3-966-er','60_dam_gen_res_data',params)
        mappings={}
        for r in rows:
            node=r.get('settlementPointName');price=numeric(r.get('energySettlementPointPrice'))
            if not node:continue
            fuel=fuel_type(r.get('resourceType'))
            mappings[(fuel,node)]={'node':node,'resource':r.get('resourceName'),'type':r.get('resourceType'),'fuel':fuel,'capacity':numeric(r.get('HSL')) or 0}
            if price is not None:
                end=interval_end(r['deliveryDate'],r['hourEnding'],repeated=r.get('DSTFlag',False))
                archive.add('resource_prices',fuel+':DAM',node,end,60,'actual',price,'np3-966-er',unit='$/MWh')
        if not mappings:raise RuntimeError('Resource disclosure unavailable; prior mappings retained')
        selected=[]
        for fuel in ['Natural Gas','Wind','Solar','Coal and Lignite','Nuclear','Hydro']:
            selected.extend(sorted([v for (f,_),v in mappings.items() if f==fuel],key=lambda v:(-v['capacity'],v['node']))[:2])
        cache={'disclosure_day':target.isoformat(),'collected_at':archive.now,'mapping_count':len(mappings),'samples':selected,'source':'np3-966-er'}
        cache_path.write_text(json.dumps(cache),encoding='utf-8')
    count=0
    for item in cache.get('samples',[]):
        for market,emil,artifact in [('DAM','np4-190-cd','dam_stlmnt_pnt_prices'),('RT','np6-905-cd','spp_node_zone_hub')]:
            params={'deliveryDateFrom':(today-timedelta(days=min(history_days,7))).isoformat(),'deliveryDateTo':today.isoformat(),'settlementPoint':item['node']}
            rows=report(http,headers,archive,emil,artifact,params)
            for r in rows:
                end=interval_end(r['deliveryDate'],r.get('hourEnding',r.get('deliveryHour')),r.get('deliveryInterval',0),r.get('DSTFlag',False))
                archive.add('node_prices',item['fuel']+':'+market,item['node'],end,60 if market=='DAM' else 15,'actual',r['settlementPointPrice'],emil,unit='$/MWh')
            count+=len(rows)
    return count

def publish_fuels(db,archive,out):
    db.row_factory=__import__('sqlite3').Row
    records=[dict(r) for r in db.execute("SELECT * FROM observations WHERE dataset IN ('commodity','node_prices','resource_prices') ORDER BY collected_at")]
    latest={}
    for r in records:latest[(r['dataset'],r['metric'],r['location'],r['target_end'])]=r
    records=list(latest.values())
    benchmarks=[]
    for name,(code,unit,_) in BENCHMARKS.items():
        benchmarks.append({'name':name,'unit':unit,'source':'https://www.eia.gov/dnav/ng/hist/'+code.lower()+'.htm','series':sorted([{'timestamp':r['target_end'],'value':r['value']} for r in records if r['dataset']=='commodity' and r['metric']==name],key=lambda r:r['timestamp'])})
    try:mapping=json.loads((archive/'resource-mapping.json').read_text())
    except (OSError,ValueError):mapping={}
    samples=[]
    for item in mapping.get('samples',[]):
        prices=defaultdict(dict)
        for r in records:
            if r['dataset']=='node_prices' and r['location']==item['node']:
                prices[r['target_end']]['rt' if r['metric'].endswith(':RT') else 'dam']=r['value']
        samples.append({**item,'series':[{'timestamp':t,**v} for t,v in sorted(prices.items())]})
    groups=defaultdict(dict)
    for r in records:
        if r['dataset']=='resource_prices':groups[(r['target_end'],r['metric'].split(':')[0])][r['location']]=r['value']
    grouped=defaultdict(dict)
    counts={}
    for (t,fuel),nodes in groups.items():grouped[t][fuel]=statistics.median(nodes.values());counts[t+'|'+fuel]=len(nodes)
    from pipeline.publish import hourly_prices, latest_records
    price_records=latest_records([dict(r) for r in db.execute("SELECT * FROM observations WHERE dataset='prices' ORDER BY collected_at,published_at")])
    daily=defaultdict(list)
    for (hub,end),p in hourly_prices(price_records).items():
        if p['complete'] and p['rt'] is not None:
            day=(parse(end)-timedelta(microseconds=1)).astimezone(CT).date().isoformat()
            daily[(hub,day)].append(p['rt'])
    hub_daily=[{'hub':hub,'date':day,'price':sum(values)/len(values),'complete_hours':len(values)} for (hub,day),values in sorted(daily.items()) if len(values)>=20]
    result={'benchmarks':benchmarks,'nodes':samples,'mapping':mapping,'hub_daily':hub_daily,'disclosure':{'series':[{'timestamp':t,**v} for t,v in sorted(grouped.items())],'node_counts':counts,'method':'Median of unique resource-node DAM prices grouped by disclosed resource type; equal node weight, not generation weight.'},'collected_at':iso(datetime.now(timezone.utc))}
    out.mkdir(parents=True,exist_ok=True)
    (out/'fuels.json').write_text(json.dumps(result,separators=(',',':'),allow_nan=False),encoding='utf-8')

def collect_enrichment(archive):
    import subprocess
    result=subprocess.run(['node',str(ROOT/'snapshot.js')],cwd=ROOT,timeout=240,check=False)
    if result.returncode:raise RuntimeError('Supplemental collection unavailable; retained prior snapshot')
    payload=json.loads((ROOT/'public/data/dashboard.json').read_text(encoding='utf-8'))
    archive.raw('nodal-lmp',payload.get('nodes',[])[-1:] )
    archive.raw('plant-inventory',payload.get('resources',{}))
    count=0
    for name in ['ancillary','reserves']:
        for row in payload.get('series',{}).get(name,[]):
            for metric,value in row.items():
                if metric in {'timestamp','interval','dstFlag'}:continue
                if numeric(value) is None:continue
                archive.add(name,metric,'SYSTEM',parse(row['timestamp']),5,'actual',value,'ERCOT dashboard',unit='MW');count+=1
    return count
