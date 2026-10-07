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
    for table in ['observations','collections']:
        dest=state/table;dest.mkdir(parents=True,exist_ok=True)
        days=[r[0] for r in db.execute(f'SELECT DISTINCT substr(collected_at,1,10) FROM {table}')]
        for day in days:
            text=''.join(json.dumps(list(r),separators=(',',':'))+'\n' for r in db.execute(f'SELECT * FROM {table} WHERE collected_at>=? AND collected_at<? ORDER BY id',(day,day+'Z')))
            path=dest/(day+'.jsonl')
            if not path.exists() or path.read_text(encoding='utf-8')!=text:path.write_text(text,encoding='utf-8')
    db.close()

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['restore','save']);p.add_argument('--state',type=Path,default=Path('state'));p.add_argument('--archive',type=Path,default=Path('archive'));args=p.parse_args()
    (restore if args.action=='restore' else save)(args.state,args.archive)

if __name__=='__main__':main()
