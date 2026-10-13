"""Portable append-history ledger for GitHub's free public repository storage.

Avoid committing a changing compressed database binary on every hourly run.
Daily JSONL files allow Git to store text deltas; SQLite is rebuilt locally.
"""
import argparse
import json
import sqlite3
from pathlib import Path
from pipeline.collect import SCHEMA

def restore(state, archive):
    archive.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(archive/'market.sqlite');db.executescript(SCHEMA)
    for table,n in [('observations',13),('collections',5)]:
        for path in sorted((state/table).glob('*.jsonl')):
            with path.open(encoding='utf-8') as f:
                batch=[]
                for line in f:
                    batch.append(json.loads(line))
                    if len(batch)>=2000:
                        db.executemany(f'INSERT OR IGNORE INTO {table} VALUES ('+','.join(['?']*n)+')',batch);batch=[]
                if batch:db.executemany(f'INSERT OR IGNORE INTO {table} VALUES ('+','.join(['?']*n)+')',batch)
    db.commit();db.close()

def save(state, archive):
    db=sqlite3.connect(archive/'market.sqlite')
    manifest_path=state/'ledger-counts.json'
    previous=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest={'schema_version':2}
    for table in ['observations','collections']:
        dest=state/table;dest.mkdir(parents=True,exist_ok=True)
        days=list(db.execute(f'SELECT substr(collected_at,1,10),COUNT(*) FROM {table} GROUP BY substr(collected_at,1,10)'))
        for day,count in days:
            key=table+':'+day;manifest[key]=count
            # Records are append-only. Unchanged partitions need no reads or rewrites.
            if previous.get('schema_version')==2 and previous.get(key)==count and (dest/(day+'-0000.jsonl')).exists():continue
            # Small text shards avoid GitHub's per-file limit during a historical backfill.
            # Stable collection order keeps new hourly records in the final shard.
            cursor=db.execute(f'SELECT * FROM {table} WHERE collected_at>=? AND collected_at<? ORDER BY collected_at,id',(day,day+'Z'))
            names=set();index=0
            while True:
                batch=cursor.fetchmany(25000)
                if not batch:break
                text=''.join(json.dumps(list(r),separators=(',',':'))+'\n' for r in batch)
                path=dest/(day+'-'+str(index).zfill(4)+'.jsonl');names.add(path.name);index+=1
                if not path.exists() or path.read_text(encoding='utf-8')!=text:path.write_text(text,encoding='utf-8')
            # Every record above has been written before removing superseded ledger files.
            legacy=dest/(day+'.jsonl')
            if legacy.exists():legacy.unlink()
            for p in dest.glob(day+'-*.jsonl'):
                if p.name not in names:p.unlink()
    db.close()
    manifest_path.write_text(json.dumps(manifest,sort_keys=True),encoding='utf-8')

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['restore','save']);p.add_argument('--state',type=Path,default=Path('state'));p.add_argument('--archive',type=Path,default=Path('archive'));args=p.parse_args()
    (restore if args.action=='restore' else save)(args.state,args.archive)

if __name__=='__main__':main()
