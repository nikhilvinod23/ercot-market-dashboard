"""Read-only ERCOT threshold quotes, archived before settlement; no account access."""
import json
import re
import urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from pipeline.collect import CT, UTC, iso, numeric, parse

BASE = 'https://external-api.kalshi.com/trade-api/v2'
SERIES = 'KXTXERCOTPEAKD'
QUOTE_FIELDS = ('yes_bid_dollars','yes_ask_dollars','no_bid_dollars','no_ask_dollars',
                'yes_bid_size_fp','yes_ask_size_fp','volume_fp','volume_24h_fp','open_interest_fp')

def operating_day(market):
    # The ticker date is often the NEXT day. Parse the actual day from the rules.
    match = re.search(r'on ([A-Z][a-z]+ \d{1,2}, \d{4})', market.get('rules_primary',''))
    return datetime.strptime(match[1], '%B %d, %Y').date().isoformat() if match else None

def collect(http, archive):
    out = Path(__file__).resolve().parents[1] / 'public/data'
    out.mkdir(parents=True, exist_ok=True)
    series = http.get(BASE + '/series/' + SERIES)['series']
    cache = archive.root / 'kalshi-markets.json'
    known = json.loads(cache.read_text()) if cache.exists() else {}
    markets=[]; cursor=''
    for _ in range(3):
        response=http.get(BASE+'/markets?'+urllib.parse.urlencode({'series_ticker':SERIES,'limit':500,'cursor':cursor}))
        markets.extend(response.get('markets',[])); cursor=response.get('cursor','')
        if not cursor:break
    original_time=archive.now
    # Receipt time for quotes must not be the beginning of a long ERCOT collection.
    archive.now=iso(datetime.now(UTC))
    active=[]
    for m in markets:
        day=operating_day(m)
        if not day or numeric(m.get('floor_strike')) is None or m.get('strike_type')!='greater': continue
        known[m['ticker']]={key:m.get(key) for key in ('ticker','event_ticker','floor_strike','result','expiration_value','status','close_time','open_time','volume_fp')}
        known[m['ticker']]['operating_day']=day
        if m.get('status') in ('active','open'):
            item={**known[m['ticker']],**{key:numeric(m.get(key)) for key in QUOTE_FIELDS},
                  'rules':m.get('rules_primary',''),'resolution':m.get('rules_secondary','')}
            item['last_price']=numeric(m.get('last_price_dollars'))
            item['captured_at']=archive.now
            active.append(item)
            for field in QUOTE_FIELDS:
                archive.add('prediction',field,m['ticker'],parse(archive.now),0,'actual',item[field],'Kalshi',unit='contracts' if field.endswith('_fp') else '$/contract')
    cache.write_text(json.dumps(known,separators=(',',':')),encoding='utf-8')
    archive.raw('kalshi-active',{'series':series,'markets':active})
    archive.db.commit()
    publish(archive, known, active, series, out)
    captured=archive.now
    archive.now=original_time
    return len(active),captured

def forecast_peaks(db, days):
    if not days:return {}
    start=datetime.fromisoformat(min(days)).replace(tzinfo=CT)
    end=datetime.fromisoformat(max(days)).replace(tzinfo=CT)+timedelta(days=1)
    db.row_factory=__import__('sqlite3').Row
    rows=db.execute("SELECT * FROM observations WHERE dataset='load' AND metric='load' AND kind='forecast' AND interval_minutes=60 AND target_end>? AND target_end<=? ORDER BY collected_at",(iso(start),iso(end)))
    bins=defaultdict(dict)
    for row in rows:
        day=(parse(row['target_end'])-timedelta(seconds=1)).astimezone(CT).date().isoformat()
        issued=row['issued_at']
        cutoff=iso(datetime.fromisoformat(day).replace(tzinfo=CT))
        if not issued or issued>=cutoff:continue
        key=(day,row['target_end'])
        if key not in bins[day] or bins[day][key]['issued_at']<issued:bins[day][key]=dict(row)
    return {day:{'day_ahead_peak':max(r['value'] for r in values.values()),'hours':len(values),
                 'captured_before_day':all(r['collected_at']<iso(datetime.fromisoformat(day).replace(tzinfo=CT)) for r in values.values())}
            for day,values in bins.items() if len(values)>=23}

def score_snapshots(records, known):
    """One captured executable quote per contract/hour window; settled days only."""
    grouped=defaultdict(dict)
    for r in records:
        grouped[(r['location'],r['target_end'])][r['metric']]=r['value']
    chosen={}
    for (ticker,timestamp),quote in sorted(grouped.items(),key=lambda item:item[0][1]):
        m=known.get(ticker,{})
        if m.get('result') not in ('yes','no') or not m.get('close_time') or timestamp>=m['close_time']:continue
        date=parse(timestamp).astimezone(CT)
        if date.date().isoformat()!=m.get('operating_day') or date.hour not in (9,12,15,18):continue
        bid=quote.get('yes_bid_dollars');ask=quote.get('yes_ask_dollars')
        if bid is None or ask is None or not 0<bid<=ask<1:continue
        if quote.get('yes_bid_size_fp',0)<=0 or quote.get('yes_ask_size_fp',0)<=0:continue
        key=(ticker,date.hour)
        if key in chosen:continue
        probability=(bid+ask)/2
        chosen[key]={'day':m['operating_day'],'hour':date.hour,'score':(probability-(m['result']=='yes'))**2,'spread':ask-bid}
    result=[]
    for hour in (9,12,15,18):
        items=[r for r in chosen.values() if r['hour']==hour]
        result.append({'hour':hour,'contracts':len(items),'days':len(set(r['day'] for r in items)),
                       'brier':sum(r['score'] for r in items)/len(items) if items else None,
                       'spread':sum(r['spread'] for r in items)/len(items) if items else None})
    return result

def publish(archive, known, active, series, out):
    cutoff=iso(parse(archive.now)-timedelta(days=30))
    archive.db.row_factory=__import__('sqlite3').Row
    records=[dict(r) for r in archive.db.execute("SELECT * FROM observations WHERE dataset='prediction' AND target_end>=? ORDER BY target_end",(cutoff,))]
    history=defaultdict(dict)
    active_ids={m['ticker'] for m in active}
    for r in records:
        if r['location'] in active_ids and r['metric'] in ('yes_bid_dollars','yes_ask_dollars'):
            history[r['location']].setdefault(r['target_end'],{'timestamp':r['target_end']})[r['metric']]=r['value']*100
    resolved=defaultdict(dict)
    for m in known.values():
        if m.get('result') in ('yes','no') and numeric(m.get('expiration_value')) is not None:
            day=m['operating_day'];resolved[day]['day']=day;resolved[day]['settled_peak']=numeric(m['expiration_value'])
            resolved[day]['volume']=resolved[day].get('volume',0)+(numeric(m.get('volume_fp')) or 0)
    selected=sorted(resolved,reverse=True)[:30]
    peaks=forecast_peaks(archive.db,selected+[m['operating_day'] for m in active])
    daily=[{**resolved[day],**peaks.get(day,{})} for day in selected]
    payload={'captured_at':archive.now,'series':SERIES,'fee_type':series.get('fee_type'),
             'fee_multiplier':series.get('fee_multiplier'),'active':sorted(active,key=lambda m:(m['operating_day'],m['floor_strike'])),
             'history':{ticker:list(values.values()) for ticker,values in history.items()},
             'settled_days':daily,'forecast_peaks':peaks,'performance':score_snapshots(records,known),
             'source':'https://kalshi.com/markets/kxtxercotpeakd/texas-ercot-peak-electricity-demand',
             'resolution_sources':series.get('settlement_sources',[]),
             'methodology':'Brier scores use the first two-sided quote captured in each 09, 12, 15 or 18 Central Time hour, before market close, for settled markets. Midpoints describe market probabilities, not guaranteed fills. Contract counts within a day are correlated. Settled peaks are Kalshi expiration values. Forecast peaks use source-issued pre-midnight ERCOT forecasts; prior capture is shown separately.'}
    (out/'kalshi.json').write_text(json.dumps(payload,separators=(',',':'),allow_nan=False),encoding='utf-8')

if __name__=='__main__':
    from pipeline.collect import Archive, HTTP
    archive=Archive(Path(__file__).resolve().parents[1]/'archive',datetime.now(UTC))
    collect(HTTP(),archive);archive.commit();archive.db.close()
