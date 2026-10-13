import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from pipeline.collect import ROOT, Archive, UTC
from pipeline.state import restore, save

class StateChecks(unittest.TestCase):
    def test_portable_history_preserves_vintages_corrections_and_incremental_days(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'tests') as folder:
            root=Path(folder);start=datetime(2026,10,13,14,tzinfo=UTC)
            original=Archive(root/'original',start)
            for value in (1,2,1):
                original.add('load','load','SYSTEM',start,60,'actual',value,'test')
                original.db.commit()
                original.now=(start+timedelta(minutes=value)).isoformat()
            original.add('load','load','SYSTEM',start,60,'forecast',10,'test','2026-10-12T20:00:00Z')
            original.add('load','load','SYSTEM',start,60,'forecast',11,'test','2026-10-12T21:00:00Z')
            original.db.commit()
            expected=original.db.execute('SELECT * FROM observations ORDER BY id').fetchall()
            original.db.close()
            save(root/'state',root/'original')
            before=(root/'state/observations/2026-10-13-0000.jsonl').read_bytes()
            restore(root/'state',root/'restored')
            restore(root/'state',root/'restored')
            with closing(sqlite3.connect(root/'restored/market.sqlite')) as db:
                self.assertEqual(db.execute('SELECT * FROM observations ORDER BY id').fetchall(),expected)
            next_day=Archive(root/'original',start+timedelta(days=1))
            next_day.add('load','load','SYSTEM',start+timedelta(days=1),60,'actual',3,'test')
            next_day.db.commit();next_day.db.close()
            save(root/'state',root/'original')
            self.assertEqual((root/'state/observations/2026-10-13-0000.jsonl').read_bytes(),before)
            restore(root/'state',root/'restored')
            with closing(sqlite3.connect(root/'restored/market.sqlite')) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],len(expected)+1)

if __name__=='__main__':unittest.main()
