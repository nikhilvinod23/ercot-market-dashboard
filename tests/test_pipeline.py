import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pipeline.collect import ROOT, Archive, interval_end, iso, parse
from pipeline.publish import hourly_prices, net_load, nullable_sub, build_snapshot, publish

class Calculations(unittest.TestCase):
    def test_missing_values_are_not_zero(self):
        self.assertIsNone(net_load(70000,None,10000))
        self.assertEqual(net_load(70000,15000,10000),45000)
        self.assertIsNone(nullable_sub(12,None))
        self.assertEqual(nullable_sub(-12,10),-22)

    def test_physical_intervals_across_dst(self):
        self.assertEqual(iso(interval_end('2026-10-06',24)),'2026-10-07T05:00:00Z')
        a=interval_end('2026-11-01',2,repeated=False)
        b=interval_end('2026-11-01',2,repeated=True)
        self.assertEqual((b-a).total_seconds(),3600)
        self.assertEqual(iso(interval_end('2026-03-08',3)),'2026-03-08T08:00:00Z')
        self.assertEqual(iso(interval_end('2026-03-08',3,1)),'2026-03-08T07:15:00Z')

    def test_rt_aggregation_uses_same_delivery_hour(self):
        rows=[{'dataset':'prices','metric':'DAM','location':'HB_HOUSTON','target_end':'2026-10-06T18:00:00Z','value':20}]
        for t,v in [('17:15',10),('17:30',20),('17:45',30),('18:00',40)]:
            rows.append({'dataset':'prices','metric':'RT','location':'HB_HOUSTON','target_end':f'2026-10-06T{t}:00Z','value':v})
        p=hourly_prices(rows)[('HB_HOUSTON','2026-10-06T18:00:00Z')]
        self.assertEqual(p['rt'],25);self.assertEqual(p['spread'],5);self.assertTrue(p['complete'])
        self.assertFalse(hourly_prices(rows[:-1])[('HB_HOUSTON','2026-10-06T18:00:00Z')]['complete'])

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'tests');self.now=parse('2026-10-06T20:00:00Z');self.archive=Archive(Path(self.tmp.name)/'archive',self.now)
    def tearDown(self): self.archive.db.close();self.tmp.cleanup()
    def test_vintage_and_correction_preserved(self):
        a=self.archive;t=parse('2026-10-06T18:00:00Z')
        a.add('load','load','SYSTEM',t,60,'forecast',60000,'test','2026-10-05T20:00:00Z')
        a.add('load','load','SYSTEM',t,60,'forecast',62000,'test','2026-10-06T12:00:00Z')
        a.add('load','load','SYSTEM',t,60,'actual',63000,'test',published='2026-10-06T18:00:00Z')
        a.add('load','load','SYSTEM',t,60,'actual',63000,'test',published='2026-10-06T19:00:00Z')
        self.assertEqual(a.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],3)
        s=build_snapshot(a.db,[],self.now);h=next(h for h in s['hours'] if h['time']==iso(t))
        self.assertEqual(h['load_forecast'],60000);self.assertEqual(h['load_error'],3000)
        self.assertEqual(h['forecast_issued']['load'],'2026-10-05T20:00:00Z')
        self.assertEqual(h['load_outlook'],62000)
    def test_failed_collection_keeps_previous_publication(self):
        out=Path(self.tmp.name)/'public';out.mkdir();(out/'latest.json').write_text('previous')
        publish(self.archive.db,[{'status':'unavailable'}],self.now,out)
        self.assertEqual((out/'latest.json').read_text(),'previous')
    def test_null_forecast_does_not_create_event(self):
        self.archive.add('load','load','SYSTEM',parse('2026-10-06T18:00:00Z'),60,'actual',70000,'test')
        s=build_snapshot(self.archive.db,[],self.now)
        self.assertEqual(s['events'],[]);self.assertIsNone(s['hours'][0]['net_load_error'])
    def test_actual_correction_can_return_to_original_value(self):
        a=self.archive;t=parse('2026-10-06T18:00:00Z')
        for v,posted in [(63000,'2026-10-06T18:00:00Z'),(64000,'2026-10-06T19:00:00Z'),(63000,'2026-10-06T20:00:00Z')]:
            a.add('load','load','SYSTEM',t,60,'actual',v,'test',published=posted)
        self.assertEqual(a.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],3)
        h=build_snapshot(a.db,[],self.now)['hours'][0];self.assertEqual(h['load'],63000)

if __name__=='__main__':unittest.main()
