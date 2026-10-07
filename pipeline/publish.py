"""Pure feature calculations and versioned public reports, separate from ingestion."""
from __future__ import annotations
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pipeline.collect import CT, HUBS, iso, parse

def nullable_sub(a,b): return None if a is None or b is None else round(a-b,3)
def net_load(load,wind,solar): return None if any(v is None for v in [load,wind,solar]) else round(load-wind-solar,3)

def hourly_prices(records):
    dam, rt= {},defaultdict(dict)
    for r in records:
        if r['dataset']!='prices': continue
        end=parse(r['target_end'])
        if r['metric']=='DAM': dam[(r['location'],iso(end))]=r['value']
        else:
            # 00:15..01:00 all belong to the UTC hour ending 01:00.
            hour=(end-timedelta(microseconds=1)).replace(minute=0,second=0,microsecond=0)+timedelta(hours=1)
            rt[(r['location'],iso(hour))][r['target_end']]=r['value']
    result={}
    for key,values in rt.items():
        count=len(values); avg=sum(values.values())/count
        result[key]={'dam':dam.get(key),'rt':round(avg,3),'spread':nullable_sub(avg,dam.get(key)),'rt_intervals':count,'complete':count==4}
    for key,v in dam.items(): result.setdefault(key,{'dam':v,'rt':None,'spread':None,'rt_intervals':0,'complete':False})
    return result

def latest_records(rows):
    # Revisions from a later collection/publication supersede earlier actual values.
    # Forecasts remain separate by exact issue time and interval length.
    chosen={}
    for r in sorted(rows,key=lambda r:(r['collected_at'],r['published_at'])):
        key=(r['dataset'],r['metric'],r['location'],r['target_end'],r['interval_minutes'],r['kind'],r['issued_at'])
        chosen[key]=r
    return list(chosen.values())

def build_snapshot(db,statuses,now):
    db.row_factory=__import__('sqlite3').Row
    floor=iso(now-timedelta(days=8)); ceiling=iso(now+timedelta(days=8))
    rows=latest_records([dict(r) for r in db.execute('SELECT * FROM observations WHERE target_end>=? AND target_end<=? ORDER BY collected_at,published_at',(floor,ceiling))])
    price_rows=[r for r in rows if r['dataset']=='prices']; price_map=hourly_prices(price_rows)
    actual={}; forecasts=defaultdict(list); display_da={}
    for r in rows:
        if r['location']!='SYSTEM' or r['interval_minutes']!=60: continue
        key=(r['metric'],r['target_end'])
        if r['kind']=='actual': actual[key]=r['value']
        elif r['issued_at']: forecasts[key].append(r)
        elif r['metric'].endswith('_day_ahead_display'): display_da[(r['metric'].replace('_day_ahead_display',''),r['target_end'])]=r['value']
    def baseline(metric,end):
        delivery_day=(parse(end)-timedelta(minutes=1)).astimezone(CT).date()
        cutoff=iso(datetime.combine(delivery_day,datetime.min.time(),CT))
        candidates=[r for r in forecasts[(metric,end)] if r['issued_at']<cutoff]
        if candidates:
            r=max(candidates,key=lambda r:r['issued_at'])
            return r['value'],r['issued_at']
        return display_da.get((metric,end)), None
    def current_forecast(metric,end):
        candidates=forecasts[(metric,end)]
        return max(candidates,key=lambda r:r['issued_at'])['value'] if candidates else None
    times=sorted({r['target_end'] for r in rows if r['interval_minutes']==60 and r['dataset'] in {'prices','load','renewables'}})
    hours=[]
    for end in times:
        a={metric:actual.get((metric,end)) for metric in ['load','wind','solar']}
        f={}; issued={}
        for metric in a: f[metric],issued[metric]=baseline(metric,end)
        prices={hub:price_map.get((hub,end),{'dam':None,'rt':None,'spread':None,'rt_intervals':0,'complete':False}) for hub in HUBS}
        hours.append({'time':end,'label':(parse(end)-timedelta(hours=1)).astimezone(CT).strftime('%b %d %H:%M %Z'),
            'load':a['load'],'wind':a['wind'],'solar':a['solar'],
            'load_forecast':f['load'],'wind_forecast':f['wind'],'solar_forecast':f['solar'],
            'load_outlook':current_forecast('load',end),'wind_outlook':current_forecast('wind',end),'solar_outlook':current_forecast('solar',end),
            'net_load':net_load(**a),'net_load_forecast':net_load(**f),
            'load_error':nullable_sub(a['load'],f['load']),'wind_error':nullable_sub(a['wind'],f['wind']),'solar_error':nullable_sub(a['solar'],f['solar']),
            'net_load_error':nullable_sub(net_load(**a),net_load(**f)), 'forecast_issued':issued,'prices':prices,
            'basis':nullable_sub(prices['HB_WEST']['rt'],prices['HB_HOUSTON']['rt'])})
    cutoff=iso(now)
    def latest(metric,location='SYSTEM',dataset=None):
        r=[r for r in rows if r['metric']==metric and r['location']==location and r['kind']=='actual' and r['target_end']<=cutoff and (not dataset or r['dataset']==dataset)]
        return max(r,key=lambda x:(x['target_end'],x['collected_at'])) if r else None
    def card(r): return {'value':r['value'],'time':r['target_end'],'unit':r['unit'],'source':r['source']} if r else {'value':None,'time':None,'unit':'','source':None}
    # Co-temporal five-minute observations for current net load.
    loads={r['target_end']:r for r in rows if r['metric']=='load' and r['interval_minutes']==5 and r['kind']=='actual'}
    winds={r['target_end']:r for r in rows if r['dataset']=='generation' and r['metric']=='Wind'}
    solars={r['target_end']:r for r in rows if r['dataset']=='generation' and r['metric']=='Solar'}
    common=sorted(t for t in loads.keys()&winds.keys()&solars.keys() if t<=cutoff)
    current={metric:card(latest(metric,dataset=dataset)) for metric,dataset in [('load','load'),('Wind','generation'),('Solar','generation'),('net_storage','storage'),('capacity','reliability')]}
    if common:
        t=common[-1];current['net_load']={'value':net_load(loads[t]['value'],winds[t]['value'],solars[t]['value']),'time':t,'unit':'MW','source':'aligned five-minute observations'}
    else: current['net_load']=card(None)
    hub_cards=[]
    for hub in HUBS:
        r=latest('RT',hub,'prices');p=card(r)
        hour_end=iso((parse(r['target_end'])-timedelta(microseconds=1)).replace(minute=0,second=0,microsecond=0)+timedelta(hours=1)) if r else ''
        dam=price_map.get((hub,hour_end),{}).get('dam')
        hub_cards.append({'hub':hub,**p,'dam':dam,'spread':nullable_sub(p['value'],dam),'interval_minutes':r['interval_minutes'] if r else None})
    storage_by_time=defaultdict(dict)
    for r in rows:
        if r['dataset']=='storage' and r['target_end']<=cutoff: storage_by_time[r['target_end']][r['metric']]=r['value']
    storage=[{'time':t,**v} for t,v in sorted(storage_by_time.items())]
    mix=[{'fuel':fuel,'value':latest(fuel,dataset='generation')['value'],'time':latest(fuel,dataset='generation')['target_end']} for fuel in ['Natural Gas','Wind','Solar','Coal and Lignite','Nuclear','Hydro','Other','Power Storage'] if latest(fuel,dataset='generation')]
    weather=[]
    for city in sorted({r['location'] for r in rows if r['dataset']=='weather'}):
        series=defaultdict(dict);issued_by_metric={}
        for r in rows:
            if r['location']==city and r['kind']=='forecast' and r['dataset']=='weather': issued_by_metric[r['metric']]=max(issued_by_metric.get(r['metric'],''),r['issued_at'])
        city_clouds=[]
        for r in rows:
            if r['location']==city and r['kind']=='forecast' and r['dataset']=='weather' and r['issued_at']==issued_by_metric.get(r['metric']):
                series[r['target_end']][r['metric']]=r['value']
                if r['metric']=='cloud_cover': city_clouds.append(r)
        # Expand grid-span cloud forecasts onto the hourly temperature timeline for display.
        # Their original interval duration remains preserved in the archive.
        for t,v in series.items():
            if 'temperature' not in v: continue
            matches=[r for r in city_clouds if parse(r['target_end'])-timedelta(minutes=r['interval_minutes'])<parse(t)<=parse(r['target_end'])]
            if matches: v['cloud_cover']=matches[-1]['value']
        weather.append({'city':city,'actual':{metric:card(latest(metric,city,'weather')) for metric in ['temperature','dew_point','humidity','wind_speed','wind_direction','precipitation']},
                        'forecast':[{'time':t,**v} for t,v in sorted(series.items())]})
    events=[]
    for h in hours:
        if h['time']>cutoff: continue
        candidates=[]
        p=h['prices']['HB_HOUSTON']
        if p['complete'] and p['spread'] is not None and abs(p['spread'])>50: candidates.append(('RT–DAM spread',p['spread'],'$/MWh',50))
        if h['net_load_error'] is not None and abs(h['net_load_error'])>3000: candidates.append(('Net load surprise',h['net_load_error'],'MW',3000))
        if h['wind_error'] is not None and abs(h['wind_error'])>2000: candidates.append(('Wind forecast deviation',h['wind_error'],'MW',2000))
        if h['basis'] is not None and h['prices']['HB_WEST']['complete'] and p['complete'] and abs(h['basis'])>50: candidates.append(('West–Houston basis',h['basis'],'$/MWh',50))
        for name,value,unit,threshold in candidates:
            events.append({'time':h['time'],'label':h['label'],'type':name,'value':round(value,2),'unit':unit,'threshold':threshold})
    count=db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
    return {'schema_version':1,'published_at':iso(now),'timezone':'America/Chicago','mode':'saved snapshot','hours':hours,'current':current,
            'hubs':hub_cards,'storage':storage,'generation':mix,'weather':weather,'events':sorted(events,key=lambda e:e['time'],reverse=True),
            'sources':statuses,'archive_records':count,
            'methodology':{'forecast_baseline':'Latest source-posted forecast before 00:00 Central Time on the delivery day; source-designated day-ahead display series used only when an issued vintage is unavailable.',
             'prices':'RT settlement point prices at native 15-minute intervals; hourly means require four intervals for event detection. DAM is hourly. Latest RT cards compare their native interval against the containing DAM hour.',
             'availability':'Issued and collected times are separate. First collection time is retained. Source-posted historical forecasts are not proof that this project captured them before delivery.',
             'limits':'Aggregate storage telemetry, not individual battery state of charge. Hub basis is a geographic price difference, not a transmission-constraint diagnosis. Missing values remain null.'}}

def publish(db,statuses,now,out):
    snapshot=build_snapshot(db,statuses,now)
    if not any(s['status']=='ok' for s in statuses): return
    out.mkdir(parents=True,exist_ok=True); reports=out/'reports';reports.mkdir(exist_ok=True)
    # No browser ever receives credentials or raw authenticated HTTP headers.
    (out/'latest.json').write_text(json.dumps(snapshot,separators=(',',':'),allow_nan=False),encoding='utf-8')
    edition=now.strftime('%Y-%m-%dT%H-%M-%SZ'); path=reports/(edition+'.json')
    historical=[h for h in snapshot['hours'] if h['time']<=iso(now)]
    def summary(days):
        rows=[h for h in historical if h['time']>=iso(now-timedelta(days=days))]
        prices=[h['prices']['HB_HOUSTON']['rt'] for h in rows if h['prices']['HB_HOUSTON']['complete']]
        prices=[p for p in prices if p is not None]
        loads=[h['load'] for h in rows if h['load'] is not None]
        errors=[abs(h['net_load_error']) for h in rows if h['net_load_error'] is not None]
        return {'days':days,'complete_price_hours':len(prices),'observed_load_hours':len(loads),'average_rt':round(sum(prices)/len(prices),2) if prices else None,
                'max_rt':max(prices) if prices else None,'peak_load':max(loads) if loads else None,'net_load_mae':round(sum(errors)/len(errors),2) if errors else None,
                'forecast_comparison_hours':len(errors),'events':len([e for e in snapshot['events'] if e['time']>=iso(now-timedelta(days=days))])}
    report={'edition':edition,'published_at':iso(now),'title':'ERCOT Market Review','daily':summary(1),'weekly':summary(7),'events':snapshot['events'][:30],'sources':statuses,'methodology':snapshot['methodology']}
    path.write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    # Retain one edition per day plus the most recent 24 intraday editions.
    files=sorted(reports.glob('*.json'),reverse=True);keep=set(files[:24]);daily={}
    for p in files: daily.setdefault(p.name[:10],p)
    keep.update(list(daily.values())[:90])
    for p in files:
        if p not in keep: p.unlink()
    index=[{'edition':p.stem,'file':'reports/'+p.name,'published_at':json.loads(p.read_text())['published_at']} for p in sorted(keep,reverse=True)]
    (out/'reports.json').write_text(json.dumps(index),encoding='utf-8')
    with (out/'hourly.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.writer(f);writer.writerow(['interval_end_utc','load_mw','wind_mw','solar_mw','net_load_mw','net_load_error_mw','houston_dam','houston_rt_hourly','rt_interval_count'])
        for h in historical: writer.writerow([h['time'],h['load'],h['wind'],h['solar'],h['net_load'],h['net_load_error'],h['prices']['HB_HOUSTON']['dam'],h['prices']['HB_HOUSTON']['rt'],h['prices']['HB_HOUSTON']['rt_intervals']])
    text=f"# ERCOT Market Review\n\nPublished {iso(now)}. All times in charts are Central Time.\n\n"
    for title,s in [('Daily',report['daily']),('Weekly',report['weekly'])]:
        text+=f"## {title}\n\nComplete Houston RT price hours: {s['complete_price_hours']}. Average RT: {s['average_rt']} $/MWh. Peak observed load: {s['peak_load']} MW. Net load error MAE: {s['net_load_mae']} MW across {s['forecast_comparison_hours']} matched hours. Events: {s['events']}.\n\n"
    text+='## Methodology\n\n'+snapshot['methodology']['forecast_baseline']+'\n\n'+snapshot['methodology']['prices']+'\n\n'+snapshot['methodology']['availability']+'\n'
    (out/'latest-report.md').write_text(text,encoding='utf-8')
