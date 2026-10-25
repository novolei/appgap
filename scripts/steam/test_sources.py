import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from analysis import review_evidence, score_game
from collect import collect, normalize_game
from sources import parse_chart, Sources
from locking import collector_lock


def chart_html(country="GLOBAL", duplicate=False):
    ids = [{"appid": i+1} for i in range(100)]
    if duplicate:
        ids[-1] = ids[0]
    countries = [{"country_code": "US", "name": "United States"}]
    data = {"loaderData": [{"strCountryCode": "" if country == "GLOBAL" else country}], "renderContext": {"queryData": json.dumps({"queries": [
        {"queryKey": ["StoreQuery", {"sort": 11 if country == "GLOBAL" else 10}, "" if country == "GLOBAL" else country], "state": {"data": {"rgItemIDs": ids}}},
        {"queryKey": ["ChartsTopSellersCountryList"], "state": {"data": countries}},
        {"queryKey": ["ChartsWeeklyTopSellers", "" if country == "GLOBAL" else country], "state": {"data": {"rtWeekStart": 100, "rgRanks": [{"itemKey": row, "nRank": i+1, "nRankLastWeek": i+2} for i, row in enumerate(ids)]}}},
    ]})}}
    return '<script type="application/json" id="valve-ssr-data">'+json.dumps(data)+"</script>"


class SourceChecks(unittest.TestCase):
    def test_exclusive_cross_platform_collector_lock(self):
        with tempfile.TemporaryDirectory(prefix='appgap-steam-lock-') as path:
            with collector_lock(Path(path)):
                with self.assertRaises(OSError):
                    with collector_lock(Path(path)):
                        self.fail('second collector must not acquire lock')

    def test_subscription_is_not_misclassified_as_a_paid_game(self):
        self.assertIsNone(normalize_game({'appid': 1289670, 'success': 1, 'visible': True, 'type': 0, 'best_purchase_option': {'recurrence_info': {'renewal_price_in_cents':'599'}}}, {}))

    def test_resumption_reuses_raw_bytes_without_network_or_new_timestamp(self):
        with tempfile.TemporaryDirectory(prefix="appgap-steam-cache-") as path:
            root = Path(path)
            cache = root/'old'
            cache.mkdir()
            (cache/'reviews-all-5.json').write_text('{"response":{"reviews":[]}}')
            stamp = (cache/'reviews-all-5.json').stat().st_mtime
            source = Sources(root/'new', cache_dir=cache)
            with patch('urllib.request.urlopen', side_effect=AssertionError('must not refetch')):
                self.assertEqual(source.get('https://api.steampowered.com/test', 'reviews-all-5')['response']['reviews'], [])
            self.assertEqual((root/'new'/'reviews-all-5.json').stat().st_mtime, stamp)
            self.assertTrue(source.receipts[0]['reused'])

    def test_region_and_order_are_source_bound(self):
        rows, countries = parse_chart(chart_html("US"), "US")
        self.assertEqual((rows[0]["appId"], rows[0]["rank"], rows[0]["previousRank"]), ("1", 1, 1))
        self.assertEqual(len(countries), 1)
        with self.assertRaisesRegex(ValueError, "different region"):
            parse_chart(chart_html("US"), "CN")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_chart(chart_html(duplicate=True), "GLOBAL")

    def test_review_denominator_and_duplicate_ids(self):
        row = {"recommendationid": "1", "voted_up": False, "review": "crash, corrupt save game and broken controller", "language": "english", "author": {"steamid": "123"}}
        evidence = review_evidence("5", {"reviews": [row, {"recommendationid": "2", "voted_up": True}]}, {"reviews": [row], "total_matching": 1000})
        self.assertEqual(evidence["allSampleN"], 2)
        self.assertEqual(evidence["negativeSampleN"], 1)
        self.assertEqual(evidence["negativeMatching30Days"], 1000)
        self.assertEqual({p["id"] for p in evidence["topics"]}, {"performance", "save", "controls"})
        self.assertEqual(review_evidence("5", {}, {})["negativeWilson95"], None)
        self.assertEqual(review_evidence('5',{'total_matching':1000},{'total_matching':200})['negativeRate30Days'],20)
        self.assertIsNone(review_evidence('5',{'total_matching':5},{'total_matching':10})['negativeRate30Days'])

    def test_scope_risk_and_missing_evidence_reduce_priority(self):
        positions = [{"chart": "sales", "country": "US", "rank": 5, "previousRank": 20}]
        focused = score_game({"tags": ["Puzzle"], "reviewCount": 1000}, positions, 29)
        mmo = score_game({"tags": ["MMORPG"], "reviewCount": 1000}, positions, 29)
        self.assertGreater(focused["feasibility"], mmo["feasibility"])
        self.assertLessEqual(focused["score"], 60)
        self.assertEqual(focused["confidence"], "初步线索")
        stale = score_game({'tags':['Puzzle']},[{**positions[0],'weekStart':1}],29,30*86400)
        self.assertIsNone(stale['momentum'])
        self.assertEqual(stale['averageRankChange'],15)


class FakeSources:
    fail = False

    def __init__(self, raw_dir):
        raw_dir.mkdir(parents=True, exist_ok=True)
        self.receipts = []

    def get(self, url, label, as_json=True):
        if label.startswith("chart-"):
            return chart_html(label.removeprefix("chart-"))
        if label == "tag-catalog":
            return [{"tagid": 1, "name": "Puzzle"}]
        if label == "free-GLOBAL":
            return {"success": 1, "results_html": "".join(f'<a data-ds-appid="{i+1}">' for i in range(100))}
        raise AssertionError(label)

    def api(self, method, body, label):
        if method == "ISteamChartsService/GetMostPlayedGames":
            return {"ranks": [{"rank": i+1, "appid": i+1, "last_week_rank": i+1} for i in range(100)]}
        if method == "IStoreBrowseService/GetItems":
            if self.fail:
                raise ValueError("injected source failure")
            return {"store_items": [{"appid": row["appid"], "success": 1, "visible": True, "name": "Puzzle", "type": 0, "is_free": True, "tagids": [1]} for row in body["ids"]]}
        raise AssertionError(method)


class PublicationChecks(unittest.TestCase):
    def test_complete_snapshot_is_atomic_and_old_cache_survives_failure(self):
        with tempfile.TemporaryDirectory(prefix="appgap-steam-test-") as path:
            directory = Path(path)
            with patch("collect.Sources", FakeSources):
                collect(directory)
                original = (directory/"latest.json").read_bytes()
                self.assertEqual(len(json.loads(original)["games"]), 100)
                FakeSources.fail = True
                try:
                    with self.assertRaisesRegex(ValueError, "injected source failure"):
                        collect(directory)
                    self.assertEqual((directory/"latest.json").read_bytes(), original)
                    self.assertEqual(json.loads((directory/"status.json").read_text())["status"], "error")
                finally:
                    FakeSources.fail = False


if __name__ == "__main__":
    unittest.main()
