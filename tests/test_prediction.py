import unittest
from pipeline.kalshi import operating_day, score_snapshots

class PredictionChecks(unittest.TestCase):
    def test_operating_day_is_not_ticker_day(self):
        self.assertEqual(operating_day({'event_ticker':'KXTXERCOTPEAKD-26OCT14','rules_primary':'If the highest hourly load on October 13, 2026 is above 75,000 MW, then Yes.'}),'2026-10-13')

    def test_scoring_uses_first_preclose_quote_only(self):
        known={'market':{'result':'yes','close_time':'2026-10-14T04:55:00Z','operating_day':'2026-10-13'}}
        records=[]
        for stamp,bid,ask in [('2026-10-13T14:05:00Z',.4,.6),('2026-10-13T14:15:00Z',.9,.99),('2026-10-14T14:05:00Z',.99,1)]:
            for metric,value in [('yes_bid_dollars',bid),('yes_ask_dollars',ask),('yes_bid_size_fp',10),('yes_ask_size_fp',20)]:
                records.append({'location':'market','target_end':stamp,'metric':metric,'value':value})
        score=score_snapshots(records,known)[0]
        self.assertEqual(score['contracts'],1)
        self.assertAlmostEqual(score['brier'],.25)
        self.assertEqual(score['days'],1)

    def test_one_sided_or_postclose_quotes_are_excluded(self):
        known={'market':{'result':'no','close_time':'2026-10-13T14:00:00Z','operating_day':'2026-10-13'}}
        records=[{'location':'market','target_end':'2026-10-13T14:05:00Z','metric':k,'value':v} for k,v in [('yes_bid_dollars',.3),('yes_ask_dollars',.4),('yes_bid_size_fp',10),('yes_ask_size_fp',10)]]
        self.assertTrue(all(s['contracts']==0 for s in score_snapshots(records,known)))

if __name__=='__main__':unittest.main()
