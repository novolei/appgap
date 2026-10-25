"""Read public Steam sources. No account, publisher key, cookie or private endpoint."""
import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

STORE = "https://store.steampowered.com"
API = "https://api.steampowered.com"


class Sources:
    def __init__(self, raw_dir):
        self.raw_dir = raw_dir
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.receipts = []
        self.lock = threading.Lock()
        self.next_at = 0.0

    def get(self, url, label, as_json=True):
        for attempt in range(4):
            with self.lock:
                start = max(time.monotonic(), self.next_at)
                self.next_at = start + 0.5
            time.sleep(max(0, start - time.monotonic()))
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "AppGap/0.2 (personal game-market research)", "Accept": "application/json, text/html;q=0.9"})
                with urllib.request.urlopen(request, timeout=25) as response:
                    if urllib.parse.urlparse(response.url).path != urllib.parse.urlparse(url).path:
                        raise ValueError("unexpected redirect: " + label)
                    raw = response.read(12 * 1024 * 1024 + 1)
                if len(raw) > 12 * 1024 * 1024:
                    raise ValueError("oversized response: " + label)
                result = json.loads(raw) if as_json else raw.decode("utf-8")
                self.raw_dir.joinpath(label + (".json" if as_json else ".html")).write_bytes(raw)
                receipt = {"label": label, "url": url, "fetchedAt": datetime.now(timezone.utc).isoformat(), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
                with self.lock:
                    self.receipts.append(receipt)
                return result
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise
                delay = min(60, max(2 ** (attempt + 1), int(error.headers.get("Retry-After", "0") or 0)))
                with self.lock:
                    self.next_at = max(self.next_at, time.monotonic() + delay)
            except (TimeoutError, urllib.error.URLError):
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError("source retries exhausted: " + label)

    def api(self, method, body, label):
        url = API + "/" + method + "/v1/?input_json=" + urllib.parse.quote(json.dumps(body, separators=(",", ":")))
        result = self.get(url, label)
        if not isinstance(result, dict) or not isinstance(result.get("response"), dict):
            raise ValueError("missing Steam API response: " + label)
        return result["response"]


def parse_chart(text, country):
    match = re.search(r'<script[^>]+id="valve-ssr-data"[^>]*>(.*?)</script>', text, re.S)
    if not match:
        raise ValueError("Steam chart SSR schema missing")
    ssr = json.loads(match[1])
    query_data = ssr["renderContext"]["queryData"]
    queries = json.loads(query_data)["queries"] if isinstance(query_data, str) else query_data["queries"]
    loader = [json.loads(row) if isinstance(row, str) else row for row in ssr["loaderData"]]
    chart_context = next(row for row in loader if isinstance(row, dict) and "strCountryCode" in row)
    expected = "" if country == "GLOBAL" else country
    if chart_context["strCountryCode"].upper() != expected:
        raise ValueError("Steam returned a different region")
    query = next(row for row in queries if row["queryKey"][0] == "StoreQuery" and row["queryKey"][1].get("sort") == (11 if country == "GLOBAL" else 10) and (country == "GLOBAL" or row["queryKey"][-1] == country))
    ids = query["state"]["data"]["rgItemIDs"]
    if not 80 <= len(ids) <= 100 or len({row.get("appid") for row in ids}) != len(ids):
        raise ValueError("incomplete or duplicate chart")
    weekly = [row["state"]["data"] for row in queries if row["queryKey"][0] == "ChartsWeeklyTopSellers" and row["queryKey"][1] == expected and len(row["state"]["data"].get("rgRanks", [])) >= 80]
    previous = max(weekly, key=lambda row: row["rtWeekStart"]) if weekly else None
    prior = {str(row["itemKey"].get("appid")): row for row in previous["rgRanks"]} if previous else {}
    items = {str(row["queryKey"][1]).removeprefix("app_"): row["state"]["data"] for row in queries if row["queryKey"][0] == "StoreItem" and row["queryKey"][2] == "default_info"}
    ranks = []
    for rank, row in enumerate(ids, 1):
        app_id = str(row.get("appid", ""))
        if not app_id.isdecimal():
            continue
        old = prior.get(app_id, {})
        purchase = items.get(app_id, {}).get("best_purchase_option", {})
        ranks.append({"country": country, "chart": "sales", "rank": rank, "appId": app_id,
                      "previousRank": old.get("nRank"), "weeklyPriorRank": old.get("nRankLastWeek"),
                      "weeks": old.get("nConsecutiveWeeks"), "weekStart": previous.get("rtWeekStart") if previous else None,
                      "localPrice": purchase.get("formatted_final_price"), "discountPct": purchase.get("discount_pct", 0)})
    regions = next(row["state"]["data"] for row in queries if row["queryKey"][0] == "ChartsTopSellersCountryList")
    if not regions or any(not re.fullmatch(r"[A-Z]{2}", row.get("country_code", "")) for row in regions):
        raise ValueError("invalid region catalog")
    return ranks, regions


def free_ids(result):
    if result.get("success") != 1:
        raise ValueError("Steam free search failed")
    ids = re.findall(r'data-ds-appid="(\d+)"', result.get("results_html", ""))
    ids = list(dict.fromkeys(ids))[:100]
    if len(ids) < 80:
        raise ValueError("incomplete global free chart")
    return ids
