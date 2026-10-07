"""Collect official free sources; archive originals and every forecast vintage.

Run: python -m pipeline.collect --env /path/to/.env
No secrets are written to any archive, snapshot, or log.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CT = ZoneInfo('America/Chicago')
UTC = timezone.utc
HUBS = ['HB_HOUSTON', 'HB_NORTH', 'HB_WEST', 'HB_SOUTH', 'HB_BUSAVG']
API = 'https://api.ercot.com/api/public-reports'
FEED = 'https://www.ercot.com/api/1/services/read/dashboards/'
CITIES = {'Houston': (29.76, -95.37, 'KIAH'), 'Dallas / Fort Worth': (32.90, -97.04, 'KDFW'),
         'Austin': (30.27, -97.74, 'KAUS'), 'San Antonio': (29.42, -98.49, 'KSAT'),
         'Midland / Odessa': (31.99, -102.08, 'KMAF'), 'Abilene': (32.45, -99.73, 'KABI'),
         'Corpus Christi': (27.80, -97.40, 'KCRP')}

def iso(dt):
    return dt.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')

def parse(value, repeated=False):
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return dt if dt.tzinfo else dt.replace(tzinfo=CT, fold=int(repeated))

def interval_end(day, hour, interval=0, repeated=False):
    """Resolve interval START in local time, then add physical minutes in UTC.

    ERCOT DSTFlag identifies the second occurrence of the repeated hour.
    This avoids inventing a nonexistent spring-forward hour from an ending label.
    """
    h = int(str(hour).split(':')[0])
    start = datetime.fromisoformat(day).replace(tzinfo=CT) + timedelta(hours=h-1)
    start = start.replace(fold=int(repeated))
    utc_start = start.astimezone(UTC)
    if utc_start.astimezone(CT).replace(tzinfo=None) != start.replace(tzinfo=None):
        # HE03 spans 01:00 CST -> 03:00 CDT on the short spring day.
        wall_end=datetime.fromisoformat(day).replace(tzinfo=CT)+timedelta(hours=h)
        utc_start=wall_end.astimezone(UTC)-timedelta(hours=1)
    return utc_start + timedelta(minutes=interval * 15 if interval else 60)

def numeric(value):
    if value is None or isinstance(value, bool): return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError): return None

def load_env(path):
    if not path or not Path(path).exists(): return
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

class HTTP:
    def __init__(self): self.last_ercot = 0.0
    def get(self, url, headers=None, data=None):
        if urllib.parse.urlparse(url).hostname not in {'api.ercot.com', 'www.ercot.com', 'api.weather.gov', 'ercotb2c.b2clogin.com'}:
            raise ValueError('Unexpected source host')
        for attempt in range(3):
            if 'api.ercot.com' in url:
                time.sleep(max(0, 2.1 - (time.monotonic()-self.last_ercot)))
                self.last_ercot = time.monotonic()
            try:
                req = urllib.request.Request(url, data=data, headers={'User-Agent': 'ERCOTMarketMonitor (github.com/nikhilvinod23/ercot-market-dashboard)', **(headers or {})})
                with urllib.request.urlopen(req, timeout=35) as r: return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code in {429, 500, 502, 503, 504} and attempt < 2:
                    time.sleep(3 * (attempt + 1)); continue
                raise RuntimeError(f'Source HTTP {e.code}') from None
            except (TimeoutError, urllib.error.URLError):
                if attempt < 2: time.sleep(2); continue
                raise RuntimeError('Source connection timed out or unavailable') from None

def ercot_headers(http):
    key = os.getenv('ERCOT_SUBSCRIPTION_KEY')
    if not key: raise RuntimeError('ERCOT credentials not configured')
    token = os.getenv('ERCOT_ID_TOKEN')
    if os.getenv('ERCOT_USERNAME') and os.getenv('ERCOT_PASSWORD'):
        body = urllib.parse.urlencode({'username': os.environ['ERCOT_USERNAME'], 'password': os.environ['ERCOT_PASSWORD'],
            'grant_type': 'password', 'scope': 'openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access',
            'client_id': 'fec253ea-0d06-4272-a5e6-b478baeecd70', 'response_type': 'id_token'}).encode()
        payload = http.get('https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token',
                           {'Content-Type': 'application/x-www-form-urlencoded'}, body)
        # The existing account was verified with access_token; never archive this payload.
        token = payload.get('access_token') or payload.get('id_token')
    if not token: raise RuntimeError('ERCOT token unavailable')
    return {'Authorization': 'Bearer '+token, 'Ocp-Apim-Subscription-Key': key}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS observations (
 id TEXT PRIMARY KEY, dataset TEXT NOT NULL, metric TEXT NOT NULL, location TEXT NOT NULL,
 target_end TEXT NOT NULL, interval_minutes INTEGER NOT NULL, kind TEXT NOT NULL,
 value REAL NOT NULL, unit TEXT NOT NULL, issued_at TEXT NOT NULL,
 published_at TEXT NOT NULL, collected_at TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_lookup ON observations(metric, location, target_end, issued_at);
CREATE INDEX IF NOT EXISTS observations_actual_revision ON observations(dataset,metric,location,target_end,interval_minutes,source,collected_at,published_at);
CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, collected_at TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, records INTEGER NOT NULL);
CREATE VIEW IF NOT EXISTS prices AS SELECT * FROM observations WHERE dataset='prices';
CREATE VIEW IF NOT EXISTS load AS SELECT * FROM observations WHERE dataset='load';
CREATE VIEW IF NOT EXISTS renewables AS SELECT * FROM observations WHERE dataset='renewables';
CREATE VIEW IF NOT EXISTS weather AS SELECT * FROM observations WHERE dataset='weather';
CREATE VIEW IF NOT EXISTS storage AS SELECT * FROM observations WHERE dataset='storage';
'''

class Archive:
    def __init__(self, root, now):
        self.root, self.now = root, iso(now)
        root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root/'market.sqlite')
        self.db.executescript(SCHEMA)
        self.added = []
        self.raw_paths = []
    def raw(self, name, payload):
        content = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        digest = hashlib.sha256(content).hexdigest()
        folder = self.root/'raw'/self.now[:10]
        folder.mkdir(parents=True, exist_ok=True)
        path = folder/(name+'-'+digest[:16]+'.json.gz')
        if not path.exists():
            with gzip.open(path, 'wb') as f: f.write(content)
        self.raw_paths.append(path)
        return digest
    def add(self, dataset, metric, location, end, minutes, kind, value, source, issued='', published='', unit='MW'):
        value = numeric(value)
        if value is None: return
        fields = [dataset, metric, location, iso(end), minutes, kind, value, unit, issued, published, source]
        identity = fields if kind=='forecast' else [*fields[:9], source]
        if kind=='actual':
            previous=self.db.execute('SELECT value FROM observations WHERE dataset=? AND metric=? AND location=? AND target_end=? AND interval_minutes=? AND source=? AND kind=\'actual\' ORDER BY collected_at DESC,published_at DESC,rowid DESC LIMIT 1',
                (dataset,metric,location,iso(end),minutes,source)).fetchone()
            if previous and previous[0]==value: return
            if previous: identity=[*fields,self.now]
        key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        row = [key, *fields[:9], published, self.now, source]
        # A correction is a new record; repeated collection does not overwrite first-seen time.
        self.db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', row)
        self.added.append(row)
    def commit(self):
        self.db.commit()
        self.db.execute('PRAGMA optimize')
        if os.getenv('DATABASE_URL'):
            import psycopg
            with psycopg.connect(os.environ['DATABASE_URL']) as db:
                db.execute(SCHEMA)
                with db.cursor() as cur:
                    cur.executemany('INSERT INTO observations VALUES ('+','.join(['%s']*13)+') ON CONFLICT (id) DO NOTHING', self.added)
        # Keep 30 days of raw response files; normalized observations retain all vintages.
        cutoff = (parse(self.now)-timedelta(days=30)).date().isoformat()
        for folder in (self.root/'raw').glob('*'):
            if folder.is_dir() and folder.name < cutoff:
                for path in folder.glob('*.json.gz'): path.unlink()
                if not any(folder.iterdir()): folder.rmdir()

def report(http, headers, archive, emil, artifact, params):
    rows, page = [], 1
    while True:
        url = f'{API}/{emil}/{artifact}?'+urllib.parse.urlencode({**params, 'size': 10000, 'page': page})
        payload = http.get(url, headers)
        archive.raw(emil+'-'+str(params.get('settlementPoint', 'system'))+'-'+str(page), payload)
        names = [f['name'] for f in payload['fields']]
        rows.extend(dict(zip(names, row)) for row in payload.get('data', []))
        if page >= payload.get('_meta', {}).get('totalPages', 1): break
        page += 1
        if page > 25: raise RuntimeError('Report exceeded bounded pagination; narrow date range')
    return rows

def collect_prices(http, headers, archive, today, history_days):
    params = {'deliveryDateFrom': (today-timedelta(days=history_days)).isoformat(), 'deliveryDateTo': (today+timedelta(days=1)).isoformat()}
    count = 0
    for hub in HUBS:
        for market, emil, artifact in [('DAM','np4-190-cd','dam_stlmnt_pnt_prices'),('RT','np6-905-cd','spp_node_zone_hub')]:
            rows = report(http, headers, archive, emil, artifact, {**params, 'settlementPoint': hub})
            for r in rows:
                end = interval_end(r['deliveryDate'], r.get('hourEnding', r.get('deliveryHour')), r.get('deliveryInterval', 0), r.get('DSTFlag', False))
                archive.add('prices', market, hub, end, 60 if market=='DAM' else 15, 'actual', r['settlementPointPrice'], emil, unit='$/MWh')
            count += len(rows)
    return count

def collect_forecasts(http, headers, archive, today):
    params = {'deliveryDateFrom': (today-timedelta(days=1)).isoformat(), 'deliveryDateTo': (today+timedelta(days=7)).isoformat(),
              'postedDatetimeFrom': (today-timedelta(days=2)).isoformat()+'T00:00:00'}
    count = 0
    for emil, artifact, metric, field in [('np3-560-cd','7d_load_fcast_by_fzn','load','systemTotal'),
             ('np4-732-cd','wpp_hrly_avrg_actl_fcast','wind','STWPFSystemWide'),
             ('np4-737-cd','spp_hrly_avrg_actl_fcast','solar','STPPFSystemWide')]:
        for r in report(http, headers, archive, emil, artifact, params):
            end = interval_end(r['deliveryDate'], r['hourEnding'], repeated=r.get('DSTFlag', False))
            issued = iso(parse(r['postedDatetime']))
            dataset = 'load' if metric=='load' else 'renewables'
            archive.add(dataset, metric, 'SYSTEM', end, 60, 'forecast', r[field], emil, issued, issued)
            if metric in {'wind', 'solar'}:
                archive.add(dataset, metric, 'SYSTEM', end, 60, 'actual', r.get('genSystemWide'), emil, published=issued)
            count += 1
    return count

def collect_feed(http, archive, name):
    p = http.get(FEED+name+'.json')
    archive.raw(name, p)
    published = iso(parse(p['lastUpdated']))
    count = 0
    if name=='fuel-mix':
        for day in p['data'].values():
            for timestamp, fuels in day.items():
                end = parse(timestamp)
                for fuel, v in fuels.items():
                    if fuel in {'Power Storage Charging', 'Power Storage Discharging'}: continue
                    archive.add('generation', fuel, 'SYSTEM', end, 5, 'actual', v['gen'], name, published=published)
                count += 1
    elif name=='supply-demand':
        for r in p['data']:
            if r.get('forecast'): continue
            end = parse(r['timestamp'])
            archive.add('load','load','SYSTEM',end,5,'actual',r.get('demand'),name,published=published)
            archive.add('reliability','capacity','SYSTEM',end,5,'actual',r.get('capacity'),name,published=published)
            count += 1
    else:
        for key in ['previousDay','currentDay','nextDay']:
            data = p.get(key,{}).get('data', [])
            if isinstance(data,dict): data=list(data.values())
            for r in data:
                end = parse(r['timestamp'])
                if name=='energy-storage-resources':
                    for metric, field in [('charging','totalCharging'),('discharging','totalDischarging'),('net_storage','netOutput')]:
                        v = r.get(field)
                        if metric=='charging' and numeric(v) is not None: v=abs(float(v))
                        archive.add('storage',metric,'SYSTEM',end,5,'actual',v,name,published=published)
                elif name=='system-wide-demand':
                    archive.add('load','load','SYSTEM',end,60,'actual',r.get('systemLoad'),name,published=published)
                    # Keep source-designated day-ahead series without inventing an issue timestamp.
                    archive.add('load','load_day_ahead_display','SYSTEM',end,60,'forecast',r.get('dayAheadForecast'),name, published=published)
                elif name=='combine-wind-solar':
                    for metric, field, daf in [('wind','actualWind','stwpfDayAhead'),('solar','actualSolar','stppfDayAhead')]:
                        archive.add('renewables',metric,'SYSTEM',end,60,'actual',r.get(field),name,published=published)
                        archive.add('renewables',metric+'_day_ahead_display','SYSTEM',end,60,'forecast',r.get(daf),name,published=published)
                count += 1
    return count, published

def collect_weather_city(http, archive, city, coordinates):
    lat, lon, station = coordinates
    point = http.get(f'https://api.weather.gov/points/{lat},{lon}')
    forecast = http.get(point['properties']['forecastHourly'])
    observed = http.get(f'https://api.weather.gov/stations/{station}/observations/latest')
    archive.raw('weather-'+station, {'forecast':forecast, 'observation':observed})
    issued = iso(parse(forecast['properties']['updateTime']))
    for r in forecast['properties']['periods']:
        end = parse(r['endTime'])
        temp = r.get('temperature')
        if temp is not None and r.get('temperatureUnit')=='F': temp=(temp-32)*5/9
        archive.add('weather','temperature',city,end,60,'forecast',temp,'NWS',issued,issued,'°C')
        archive.add('weather','humidity',city,end,60,'forecast',r.get('relativeHumidity',{}).get('value'),'NWS',issued,issued,'%')
        speed = r.get('windSpeed','').split(' ')[0]
        archive.add('weather','wind_speed',city,end,60,'forecast',numeric(speed)*0.44704 if numeric(speed) is not None else None,'NWS',issued,issued,'m/s')
        archive.add('weather','precip_probability',city,end,60,'forecast',r.get('probabilityOfPrecipitation',{}).get('value'),'NWS',issued,issued,'%')
    p = observed['properties']; end = parse(p['timestamp'])
    for metric, field, unit in [('temperature','temperature','°C'),('dew_point','dewpoint','°C'),('humidity','relativeHumidity','%'),('wind_speed','windSpeed','m/s'),('wind_direction','windDirection','°'),('precipitation','precipitationLastHour','mm')]:
        q=p.get(field,{}); v=q.get('value')
        if v is not None and metric=='wind_speed' and q.get('unitCode')=='wmoUnit:km_h-1': v/=3.6
        if v is not None and metric=='precipitation' and q.get('unitCode')=='wmoUnit:m': v*=1000
        archive.add('weather',metric,city,end,0,'actual',v,'NWS')
    # Quantitative NWS grid cloud forecasts, independent of station observations.
    grid = http.get(point['properties']['forecastGridData'])
    archive.raw('weather-grid-'+station, grid)
    gp=grid['properties']; issued_grid=iso(parse(gp['updateTime']))
    for v in gp.get('skyCover',{}).get('values',[]):
        start, duration=v['validTime'].split('/')
        # NWS grid values span multiple hours; preserve their actual start and duration.
        import re
        match=re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?',duration)
        if not match: continue
        d,h,m=[int(x or 0) for x in match.groups()]; minutes=d*1440+h*60+m
        archive.add('weather','cloud_cover',city,parse(start)+timedelta(minutes=minutes),minutes,'forecast',v['value'],'NWS',issued_grid,issued_grid,'%')
    return len(forecast['properties']['periods']), iso(end)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--env',default=str(ROOT/'.env'))
    parser.add_argument('--archive',default=str(ROOT/'archive')); parser.add_argument('--history-days',type=int,default=7)
    parser.add_argument('--skip-weather',action='store_true'); args=parser.parse_args()
    load_env(args.env); now=datetime.now(UTC); archive=Archive(Path(args.archive),now); http=HTTP(); statuses=[]
    today=now.astimezone(CT).date()
    def run(name,url,fn):
        try:
            outcome=fn(); count, latest=outcome if isinstance(outcome,tuple) else (outcome,None)
            status={'name':name,'url':url,'status':'ok','records':count,'updated':latest,'checked':iso(now)}
        except Exception as e:
            # Never serialize error bodies, URLs with secrets, or authentication responses.
            status={'name':name,'url':url,'status':'unavailable','records':0,'message':str(e) if isinstance(e,RuntimeError) else type(e).__name__,'checked':iso(now)}
        statuses.append(status); print(name+': '+status['status']+' ('+str(status['records'])+' records)',flush=True)
        archive.db.execute('INSERT INTO collections VALUES (?,?,?,?,?)',(hashlib.sha256((iso(now)+name).encode()).hexdigest(),iso(now),name,status['status'],status['records']))
    try: headers=ercot_headers(http)
    except RuntimeError: headers=None
    def require_headers():
        if headers is None: raise RuntimeError('ERCOT authentication unavailable; configure repository secrets')
        return headers
    run('Hub prices', 'https://www.ercot.com/mktinfo/prices/',lambda:collect_prices(http,require_headers(),archive,today,args.history_days))
    run('Forecast vintages','https://www.ercot.com/gridinfo/generation/',lambda:collect_forecasts(http,require_headers(),archive,today))
    for name in ['supply-demand','system-wide-demand','combine-wind-solar','energy-storage-resources','fuel-mix']:
        run(name,FEED+name+'.json',lambda n=name:collect_feed(http,archive,n))
    if not args.skip_weather:
        for city,coords in CITIES.items():
            run('Weather: '+city,'https://www.weather.gov/documentation/services-web-api',lambda c=city,p=coords:collect_weather_city(http,archive,c,p))
    archive.commit()
    from pipeline.publish import publish
    publish(archive.db,statuses,now,ROOT/'public'/'data')
    archive.db.close()
    if not any(s['status']=='ok' for s in statuses): raise SystemExit('No sources available; previous published snapshot retained')

if __name__=='__main__': main()
