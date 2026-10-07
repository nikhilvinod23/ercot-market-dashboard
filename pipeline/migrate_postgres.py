"""Mirror the full SQLite archive to PostgreSQL without discarding vintages."""
import argparse
import os
import sqlite3
from pathlib import Path
from pipeline.collect import ROOT, SCHEMA, load_env

def main():
    p=argparse.ArgumentParser();p.add_argument('--env',default=str(ROOT/'.env'));p.add_argument('--archive',default=str(ROOT/'archive/market.sqlite'));args=p.parse_args()
    load_env(args.env)
    if not os.getenv('DATABASE_URL'):raise SystemExit('Set DATABASE_URL for PostgreSQL you control.')
    import psycopg
    source=sqlite3.connect(args.archive)
    with psycopg.connect(os.environ['DATABASE_URL']) as target:
        target.execute(SCHEMA)
        with target.cursor() as cur:
            query=source.execute('SELECT * FROM observations')
            count=0
            while batch:=query.fetchmany(1000):
                cur.executemany('INSERT INTO observations VALUES ('+','.join(['%s']*13)+') ON CONFLICT(id) DO NOTHING',batch)
                count+=len(batch)
    source.close();print('Mirrored',count,'observations, preserving forecast vintages and first-seen times.')

if __name__=='__main__':main()
