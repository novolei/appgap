"""Transparent prioritisation heuristics. Rankings are not revenue or market share."""
import math
import re
from collections import Counter, defaultdict
ANALYSIS_VERSION = '2026-10-25.3'

PAINS = [
    ("performance", "性能与稳定性", r"crash|stutter|fps|optim[iz]|lag\b|卡顿|闪退|优化|帧|クラッシュ|重い|вылет|оптимиза|тормоз"),
    ("onboarding", "引导与上手", r"tutorial|confus|explain|learning curve|新手|教程|引导|说明|チュートリアル|обучени"),
    ("controls", "操作与无障碍", r"control|keybind|controller|accessib|colorblind|手柄|键位|操作|无障碍|コントローラ|управлен"),
    ("content", "内容深度与重复", r"repetit|content|boring|grind|shallow|重复|无聊|内容少|刷刷|作业|単調|контент|однообраз"),
    ("monetization", "定价与付费摩擦", r"pay.?to.?win|p2w|microtransaction|overpriced|cash grab|battle pass|氪|逼氪|收费|定价|通行证|課金|донат"),
    ("multiplayer", "匹配与协作体验", r"matchmak|server|disconnect|desync|co.?op|cheat|toxic|匹配|服务器|掉线|联机|外挂|チート|сервер|читер"),
    ("save", "存档与进度安全", r"save.?game|save file|lost.*progress|cloud save|存档|丢档|进度丢|セーブ|сохранен"),
    ("localization", "本地化与可读性", r"locali[sz]|translat|language|font size|text size|翻译|汉化|中文|字体|日本語|перевод|локализа"),
    ("balance", "平衡与公平", r"unbalanc|balance|difficulty spike|rng|平衡|数值|难度|随机|バランス|баланс"),
]
EXTRA_LANGUAGES = {
    "performance": r"absturz|ruckel|plantage|saccad|bajones|rendimiento|travamento|desempenho|최적화|프레임|튕|çökme|wydajność",
    "onboarding": r"anleitung|einsteiger|didacticiel|tutoriel|aprendizaje|aprendizado|튜토리얼|초보|samouczek",
    "controls": r"steuerung|tastenbelegung|manette|commandes|controles|comandos|조작|컨트롤러|sterowanie",
    "content": r"langweilig|wiederhol|ennuyeux|répétitif|aburrid|repetitivo|entediante|반복|콘텐츠|powtarzal",
    "monetization": r"überteuert|mikrotransaktion|trop cher|microtransaction|caro demais|abusiv|과금|현질|mikropłatno",
    "multiplayer": r"verbindung|verbindungsabbruch|triche|serveur|servidor|emparejamiento|매칭|서버|핵쟁이|łączeni",
    "save": r"spielstand|sauvegarde|partida guardada|salvamento|저장|세이브|zapis gry",
    "localization": r"übersetzung|traduction|traducción|tradução|번역|한글|tłumaczen",
    "balance": r"schwierigkeits|équilibr|equilibrio|balanceamento|밸런스|난이도|zbalans",
}
COMPILED_PAINS = [(key, label, re.compile(pattern+"|"+EXTRA_LANGUAGES[key], re.I)) for key, label, pattern in PAINS]
HIGH_SCOPE = {"MMORPG", "Massively Multiplayer", "Open World", "Battle Royale"}
FOCUSED = {"Puzzle", "Roguelike", "Roguelite", "Deckbuilding", "Turn-Based Strategy", "Cozy", "Management", "Automation", "Precision Platformer", "Hidden Object", "Cooking", "Fishing"}


def excerpt(text):
    text = re.sub(r"\s+", " ", text).strip()
    if re.search(r"[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]", text):
        return text[:40]
    return " ".join(text.split()[:20])[:140]


def review_evidence(app_id, all_page, negative_page):
    all_reviews = list({str(row['recommendationid']): row for row in all_page.get("reviews", [])}.values())
    negatives = {str(row["recommendationid"]): row for row in all_reviews + negative_page.get("reviews", []) if not row.get("voted_up")}
    evidence = []
    counts = Counter()
    for review_id, row in negatives.items():
        matched = [key for key, _, pattern in COMPILED_PAINS if pattern.search(row.get("review", ""))]
        counts.update(matched)
        author_id = str(row.get("author", {}).get("steamid", ""))
        evidence.append({"id": review_id, "language": row.get("language", "unknown"), "topics": matched,
                         "createdAt": row.get("timestamp_created"), "minutesAtReview": row.get("author", {}).get("playtime_at_review"),
                         "excerpt": excerpt(row.get("review", "")), "steamPurchase": row.get("steam_purchase"),
                         "receivedForFree": row.get("received_for_free"), "refunded": row.get("refunded"),
                         "url": f"https://steamcommunity.com/profiles/{author_id}/recommended/{app_id}/" if author_id.isdecimal() else f"https://store.steampowered.com/app/{app_id}/"})
    n = len(all_reviews)
    negative_n = sum(not row.get("voted_up") for row in all_reviews)
    interval = None
    if n:
        z = 1.96
        p = negative_n / n
        center = (p + z*z/(2*n))/(1+z*z/n)
        spread = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
        interval = [round(max(0, center-spread)*100, 1), round(min(1, center+spread)*100, 1)]
    total = all_page.get('total_matching')
    negative_total = negative_page.get('total_matching')
    negative_rate = round(negative_total/total*100,1) if isinstance(total,int) and total>0 and isinstance(negative_total,int) and 0<=negative_total<=total else None
    return {"allSampleN": n, "negativeInAllSample": negative_n, "negativeWilson95": interval,
            "negativeRate30Days": negative_rate,
            "matching30Days": all_page.get("total_matching"), "negativeMatching30Days": negative_page.get("total_matching"),
            "negativeSampleN": len(evidence), "languages": dict(Counter(row.get("language", "unknown") for row in all_reviews)),
            "purchase": {"steam": sum(bool(row.get("steam_purchase")) for row in all_reviews), "external": sum(not row.get("steam_purchase") for row in all_reviews), "receivedFree": sum(bool(row.get("received_for_free")) for row in all_reviews), "refunded": sum(bool(row.get("refunded")) for row in all_reviews)},
            "firstTimestamp": min((r.get("timestamp_created", 0) for r in all_reviews), default=None),
            "lastTimestamp": max((r.get("timestamp_created", 0) for r in all_reviews), default=None),
            "topics": [{"id": key, "label": label, "hits": counts[key], "denominator": len(evidence)} for key, label, _ in PAINS if counts[key]],
            "evidence": sorted(evidence, key=lambda row: len(row["topics"]), reverse=True)}


def score_game(game, positions, region_count, observed_at=None):
    sales = [row for row in positions if row["chart"] == "sales"]
    regions = {row["country"] for row in sales if row["country"] != "GLOBAL"}
    best = min((row["rank"] for row in sales), default=None)
    deltas = [row["previousRank"]-row["rank"] for row in sales if row.get("previousRank") is not None]
    fresh_deltas = [row["previousRank"]-row["rank"] for row in sales if row.get("previousRank") is not None and (observed_at is None or row.get("weekStart") is not None and 0 <= observed_at-row["weekStart"] <= 14*86400)]
    momentum = max(0, min(100, 50+sum(fresh_deltas)/len(fresh_deltas)*1.5)) if fresh_deltas else None
    reviews = game.get("reviews", {})
    negative_n = reviews.get("negativeSampleN", 0)
    theme_max = max((row["hits"] for row in reviews.get("topics", [])), default=0)
    repeatable_pain = min(100, theme_max/max(negative_n, 1)*100) if negative_n >= 5 else 0
    rate = reviews.get('negativeRate30Days')
    repeatable_pain *= min(1, rate/35) if rate is not None else .5
    tags = set(game.get("tags", []))
    feasibility = 25 if tags & HIGH_SCOPE else 65 if "Online Co-Op" in tags or "Co-op" in tags else 75
    if set(game.get("tags", [])[:6]) & FOCUSED and not tags & HIGH_SCOPE:
        feasibility = min(90, feasibility+10)
    demand = min(100, len(regions)/max(1, region_count)*45 + (25 if best is not None and best <= 20 else 10 if best else 0) + min(30, math.log10(1+game.get("reviewCount", 0))*5))
    score = demand*.3 + repeatable_pain*.25 + (momentum or 0)*.2 + feasibility*.25
    confidence = "可核对的样本" if reviews.get("allSampleN", 0) >= 30 and negative_n >= 10 and len(regions) >= 3 else "初步线索"
    if confidence == "初步线索":
        score = min(score, 60)
    return {"score": round(score, 1), "demand": round(demand, 1), "pain": round(repeatable_pain, 1),
            "momentum": round(momentum, 1) if momentum is not None else None, "feasibility": feasibility,
            "confidence": confidence, "regions": len(regions), "bestSalesRank": best,
            "averageRankChange": round(sum(deltas)/len(deltas), 1) if deltas else None, "changeComparisons": len(deltas)}


def analyze(snapshot):
    snapshot['analysisVersion'] = ANALYSIS_VERSION
    positions = defaultdict(list)
    for row in snapshot["ranks"]:
        positions[row["appId"]].append(row)
    for app_id, game in snapshot["games"].items():
        game["opportunity"] = score_game(game, positions[app_id], len(snapshot["countries"])-1, snapshot["reviewWindow"]["end"])
    return snapshot
