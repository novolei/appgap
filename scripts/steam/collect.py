"""Daily regional Steam snapshots, atomic publication and compact rank history."""
import argparse
import concurrent.futures
import gzip
import json
import os
import pathlib
import shutil
import sqlite3
import sys
import time
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from analysis import analyze, review_evidence
from sources import API, STORE, Sources, free_ids, parse_chart
from locking import collector_lock


def atomic_json(path, value):
    temporary = path.with_suffix(".new")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def normalize_game(item, tag_names):
    app_id = str(item["appid"])
    if not app_id.isdecimal() or item.get("success") != 1 or not item.get("visible"):
        return None
    basic = item.get("basic_info", {})
    purchase = item.get("best_purchase_option", {})
    if purchase.get("recurrence_info") or purchase.get("package_group") == "subscriptions":
        return None
    summary = item.get("reviews", {}).get("summary_filtered", {})
    assets = item.get("assets", {})
    image = assets.get("asset_url_format", "").replace("${FILENAME}", assets.get("small_capsule", ""))
    return {"appId": app_id, "name": item.get("name", app_id), "type": item.get("type"), "free": bool(item.get("is_free")),
            "description": basic.get("short_description", "")[:1200], "tags": [tag_names.get(str(tag), "#"+str(tag)) for tag in item.get("tagids", [])],
            "developers": [row["name"] for row in basic.get("developers", [])], "publishers": [row["name"] for row in basic.get("publishers", [])],
            "priceUsd": float(purchase["final_price_in_cents"])/100 if "final_price_in_cents" in purchase else 0 if item.get("is_free") else None,
            "priceOriginalUsd": float(purchase["original_price_in_cents"])/100 if "original_price_in_cents" in purchase else None,
            "discountPct": purchase.get("discount_pct", 0), "reviewCount": summary.get("review_count", 0), "positivePct": summary.get("percent_positive") if summary.get("review_count",0)>0 else None,
            "reviewLabel": summary.get("review_score_label"), "releaseTimestamp": item.get("release", {}).get("steam_release_date"),
            "platforms": item.get("platforms", {}), "url": f"{STORE}/app/{app_id}/", "image": "https://shared.fastly.steamstatic.com/store_item_assets/"+image if image else None}


def collect(directory, resume_run=None):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    database = sqlite3.connect(directory/"history.sqlite", timeout=10)
    database.executescript("""PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, payload TEXT, error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_running ON runs(status) WHERE status='running';
      CREATE TABLE IF NOT EXISTS rank_history (date TEXT, country TEXT, chart TEXT, app_id TEXT, rank INTEGER, PRIMARY KEY(date,country,chart,app_id));
      CREATE TABLE IF NOT EXISTS catalog (app_id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);
    """)
    now = datetime.now(timezone.utc)
    cache_dir = None
    if resume_run is not None:
        previous = database.execute("SELECT started_at,status,payload FROM runs WHERE id=?", (resume_run,)).fetchone()
        if not previous:
            raise ValueError("resume requires an interrupted or failed run")
        if previous[1] == 'success':
            coverage = json.loads(previous[2] or '{}').get('reviewCoverage',{})
            if coverage.get('succeeded',0) >= coverage.get('targeted',0):
                raise ValueError("completed snapshot does not need resuming")
        now = datetime.fromisoformat(previous[0])
        cache_dir = directory/'raw'/str(resume_run)
        database.execute("UPDATE runs SET status='error',error='interrupted; resumed from cached source responses' WHERE id=? AND status='running'", (resume_run,))
    database.execute("UPDATE runs SET status='error',error='expired after two hours' WHERE status='running' AND started_at < ?", ((now-timedelta(hours=2)).isoformat(),))
    try:
        run_id = database.execute("INSERT INTO runs(started_at,status) VALUES (?,'running')", (now.isoformat(),)).lastrowid
        database.commit()
    except sqlite3.IntegrityError:
        raise SystemExit("Steam ingest already running")
    raw_dir = directory/"raw"/str(run_id)
    source = Sources(raw_dir, cache_dir=cache_dir) if cache_dir else Sources(raw_dir)

    def progress(phase, **counts):
        status = {"runId": run_id, "status": "running", "startedAt": now.isoformat(), "phase": phase, **counts}
        atomic_json(directory/"status.json", status)
        print(json.dumps(status, ensure_ascii=False), flush=True)

    try:
        progress("official regional charts")
        global_url = STORE+"/charts/topselling/global?cc=US&l=english"
        ranks, countries = parse_chart(source.get(global_url, "chart-GLOBAL", False), "GLOBAL")
        regions = [{"id": "GLOBAL", "name": "Global"}]+[{"id": row["country_code"], "name": row["name"]} for row in countries]
        coverage = [{"country": "GLOBAL", "source": global_url, "status": "ok", "rows": len(ranks)}]

        def chart(row):
            code = row["id"]
            url = STORE+f"/charts/topselling/{code}?cc={code}&l=english"
            try:
                data, _ = parse_chart(source.get(url, "chart-"+code, False), code)
                return data, {"country": code, "source": url, "status": "ok", "rows": len(data)}
            except Exception as error:
                return [], {"country": code, "source": url, "status": "error", "error": str(error)[:300], "rows": 0}

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for rows, receipt in pool.map(chart, regions[1:]):
                ranks.extend(rows)
                coverage.append(receipt)
        if sum(row["status"] == "ok" for row in coverage) < len(regions)*.9:
            raise ValueError("fewer than 90% of regional charts were collected")
        free_url = STORE+"/search/results/?filter=topsellers&maxprice=free&category1=998&count=100&start=0&infinite=1&cc=US&l=english"
        try:
            free = free_ids(source.get(free_url, "free-GLOBAL"))
            ranks.extend({"country": "GLOBAL", "chart": "free", "rank": rank, "appId": app_id} for rank, app_id in enumerate(free, 1))
            coverage.append({"country": "GLOBAL", "chart": "free", "source": free_url, "status": "ok", "rows": len(free)})
        except Exception as error:
            coverage.append({"country": "GLOBAL", "chart": "free", "source": free_url, "status": "error", "error": str(error)[:300]})
        try:
            played = source.api("ISteamChartsService/GetMostPlayedGames", {}, "most-played").get("ranks", [])
            if len(played) < 80:
                raise ValueError("incomplete most-played chart")
            ranks.extend({"country": "GLOBAL", "chart": "players", "rank": row["rank"], "appId": str(row["appid"]), "previousRank": row.get("last_week_rank"), "peakPlayers": row.get("peak_in_game")} for row in played)
            coverage.append({"country": "GLOBAL", "chart": "players", "source": API+"/ISteamChartsService/GetMostPlayedGames/v1/", "status": "ok", "rows": len(played)})
        except Exception as error:
            coverage.append({"country": "GLOBAL", "chart": "players", "status": "error", "error": str(error)[:300]})
        tags = source.get(STORE+"/tagdata/populartags/english", "tag-catalog")
        tag_names = {str(row["tagid"]): row["name"] for row in tags}
        ids = sorted({row["appId"] for row in ranks}, key=int)
        games = {}
        metadata_returned = set()
        progress("store metadata", chartRows=len(ranks), uniqueIds=len(ids), regions=len(regions))
        for offset in range(0, len(ids), 50):
            data = source.api("IStoreBrowseService/GetItems", {"ids": [{"appid": int(app_id)} for app_id in ids[offset:offset+50]], "context": {"country_code": "US", "language": "english"}, "data_request": {"include_basic_info": True, "include_tag_count": 20, "include_reviews": True, "include_categories": True, "include_release": True, "include_platforms": True, "include_assets": True}}, "metadata-"+str(offset))
            for item in data.get("store_items", []):
                if item.get("success") == 1:
                    metadata_returned.add(str(item.get("appid")))
                game = normalize_game(item, tag_names)
                if game and game["type"] == 0:
                    games[game["appId"]] = game
        if len(games) < 50 or len(metadata_returned) < len(ids)*.9:
            raise ValueError("insufficient game metadata")
        coverage.append({"source": "IStoreBrowseService/GetItems", "status": "ok", "requested": len(ids), "returned": len(metadata_returned), "fullGames": len(games), "unavailableOrExcluded": len(ids)-len(games)})
        ranks = [row for row in ranks if row["appId"] in games]
        targets = [game for game in games.values() if game["reviewCount"] > 0]
        review_start = int((now-timedelta(days=30)).timestamp())
        review_end = int(now.timestamp())
        progress("bounded 30-day review samples", games=len(games), reviewTargets=len(targets))
        review_failures = 0
        failure_lock = threading.Lock()
        review_unavailable = threading.Event()

        def reviews(game):
            nonlocal review_failures
            app_id = game["appId"]
            if review_unavailable.is_set():
                return app_id, None, "review source paused after repeated transport failures; retry on next run"
            body = {"appid": int(app_id), "languages": ["all"], "filter": 1, "purchase_type": 1, "num_per_page": 100, "filter_offtopic_activity": True, "date_range_start": review_start, "date_range_end": review_end}
            try:
                all_page = source.api("IUserReviewsService/GetAppReviews", {**body, "review_type": 0}, "reviews-all-"+app_id)
                negative_page = source.api("IUserReviewsService/GetAppReviews", {**body, "review_type": 2, "num_per_page": 50}, "reviews-negative-"+app_id)
                if any(not review_start <= row.get("timestamp_created", 0) <= review_end for page in (all_page, negative_page) for row in page.get("reviews", [])):
                    raise ValueError("review timestamps outside the requested 30-day window")
                with failure_lock:
                    review_failures = 0
                return app_id, review_evidence(app_id, all_page, negative_page), None
            except Exception as error:
                with failure_lock:
                    review_failures += 1
                    if review_failures >= 3:
                        review_unavailable.set()
                return app_id, None, str(error)[:200]

        review_ok = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for index, (app_id, evidence, error) in enumerate(pool.map(reviews, targets), 1):
                if evidence is not None:
                    games[app_id]["reviews"] = evidence
                    review_ok += 1
                else:
                    games[app_id]["reviewError"] = error
                if index % 25 == 0:
                    progress("bounded 30-day review samples", reviewed=index, reviewTargets=len(targets), reviewSuccess=review_ok)
        snapshot = analyze({"schemaVersion": 1, "runId": run_id, "capturedAt": datetime.now(timezone.utc).isoformat(), "startedAt": now.isoformat(), "date": now.astimezone(timezone(timedelta(hours=8))).date().isoformat(), "reviewWindow": {"start": review_start, "end": review_end, "days": 30}, "countries": regions, "games": games, "ranks": ranks, "coverage": coverage, "sources": sorted(source.receipts, key=lambda row: row["label"]), "reviewCoverage": {"targeted": len(targets), "succeeded": review_ok}})
        previous_file = directory/'latest.json'
        if targets and review_ok/len(targets) < .9 and previous_file.exists():
            previous_coverage = json.loads(previous_file.read_bytes()).get('reviewCoverage',{})
            if previous_coverage.get('targeted',0) and previous_coverage.get('succeeded',0)/previous_coverage['targeted'] >= .9:
                raise ValueError('review source incomplete; preserving the previous well-covered snapshot')
        payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode()) > 25*1024*1024:
            raise ValueError("snapshot exceeds bounded web cache budget")
        with database:
            database.execute("UPDATE runs SET status='success',finished_at=?,payload=? WHERE id=?", (snapshot["capturedAt"], payload, run_id))
            database.execute("DELETE FROM rank_history WHERE date=?", (snapshot["date"],))
            database.executemany("INSERT OR REPLACE INTO rank_history VALUES (?,?,?,?,?)", [(snapshot["date"], row["country"], row["chart"], row["appId"], row["rank"]) for row in ranks])
            database.executemany("INSERT OR REPLACE INTO catalog VALUES (?,?,?)", [(app_id, json.dumps({k:v for k,v in game.items() if k not in ('reviews','opportunity')}), snapshot["capturedAt"]) for app_id, game in games.items()])
            database.execute("DELETE FROM rank_history WHERE date < date(?, '-400 days')", (snapshot["date"],))
            database.execute("UPDATE runs SET payload=NULL WHERE id NOT IN (SELECT id FROM runs WHERE status='success' ORDER BY id DESC LIMIT 7)")
        atomic_json(directory/"latest.json", snapshot)
        atomic_json(directory/"status.json", {"runId": run_id, "status": "success", "finishedAt": snapshot["capturedAt"], "games": len(games), "ranks": len(ranks), "reviewCoverage": snapshot["reviewCoverage"]})
        for old in (directory/"raw").iterdir():
            if old.is_dir() and old.name.isdecimal() and int(old.name) < run_id-6 and old.resolve().is_relative_to((directory/"raw").resolve()):
                shutil.rmtree(old)
        print("STEAM_INGEST_OK", len(games), "games", len(ranks), "ranks", review_ok, "review samples", flush=True)
    except BaseException as error:
        with database:
            database.execute("UPDATE runs SET status='error',finished_at=?,error=? WHERE id=?", (datetime.now(timezone.utc).isoformat(), str(error)[:600], run_id))
        atomic_json(directory/"status.json", {"runId": run_id, "status": "error", "error": str(error)[:600], "finishedAt": datetime.now(timezone.utc).isoformat()})
        raise
    finally:
        database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=pathlib.Path, default=pathlib.Path("/var/lib/appgap/steam"))
    parser.add_argument("--resume-run", type=int)
    args = parser.parse_args()
    with collector_lock(args.directory):
        collect(args.directory, args.resume_run)
