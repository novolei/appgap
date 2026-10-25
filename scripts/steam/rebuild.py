"""Recalculate a completed snapshot from verified raw responses, without network access."""
import argparse
import hashlib
import json
import pathlib
import sqlite3
from datetime import datetime, timezone
from collect import atomic_json, normalize_game
from analysis import analyze, review_evidence
from locking import collector_lock


def rebuild(directory):
    snapshot = json.loads((directory/'latest.json').read_bytes())
    raw = directory/'raw'/str(snapshot['runId'])
    receipts = {row['label']: row for row in snapshot['sources']}

    def read(label):
        data = (raw/(label+'.json')).read_bytes()
        if hashlib.sha256(data).hexdigest() != receipts[label]['sha256']:
            raise ValueError('raw response checksum mismatch: '+label)
        return json.loads(data)

    names = {str(row['tagid']): row['name'] for row in read('tag-catalog')}
    games = {}
    for label in receipts:
        if label.startswith('metadata-'):
            for item in read(label)['response'].get('store_items', []):
                game = normalize_game(item, names)
                if game and game['type'] == 0:
                    games[game['appId']] = game
    succeeded = 0
    for app_id, game in games.items():
        if game['reviewCount'] == 0:
            continue
        labels = ['reviews-all-'+app_id, 'reviews-negative-'+app_id]
        if all(label in receipts for label in labels):
            all_page, negative_page = [read(label)['response'] for label in labels]
            assert all(snapshot['reviewWindow']['start'] <= review['timestamp_created'] <= snapshot['reviewWindow']['end'] for page in (all_page,negative_page) for review in page.get('reviews',[]))
            game['reviews'] = review_evidence(app_id, all_page, negative_page)
            succeeded += 1
        else:
            game['reviewError'] = snapshot['games'].get(app_id,{}).get('reviewError','incomplete cached review responses')
    snapshot['games'] = games
    snapshot['ranks'] = [row for row in snapshot['ranks'] if row['appId'] in games]
    snapshot['reviewCoverage'] = {'targeted':sum(g['reviewCount']>0 for g in games.values()),'succeeded':succeeded}
    snapshot['analysisVersion'] = '2026-10-25.3'
    snapshot['analyzedAt'] = datetime.now(timezone.utc).isoformat()
    for row in snapshot['coverage']:
        if row.get('source') == 'IStoreBrowseService/GetItems':
            row['fullGames'] = len(games)
            row['unavailableOrExcluded'] = row['requested']-len(games)
    analyze(snapshot)
    assert len(games)>=50 and len({(r['country'],r['chart'],r['appId']) for r in snapshot['ranks']})==len(snapshot['ranks'])
    connection = sqlite3.connect(directory/'history.sqlite',timeout=10)
    try:
        connection.execute('BEGIN IMMEDIATE')
        if connection.execute("SELECT COUNT(*) FROM runs WHERE status='running'").fetchone()[0]:
            raise RuntimeError('cannot rebuild while ingest is running')
        if connection.execute("SELECT MAX(id) FROM runs WHERE status='success'").fetchone()[0] != snapshot['runId']:
            raise RuntimeError('latest file and history run disagree')
        connection.execute('UPDATE runs SET payload=? WHERE id=?',(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')),snapshot['runId']))
        connection.execute('DELETE FROM rank_history WHERE date=?',(snapshot['date'],))
        connection.executemany('INSERT INTO rank_history VALUES (?,?,?,?,?)',[(snapshot['date'],r['country'],r['chart'],r['appId'],r['rank']) for r in snapshot['ranks']])
        connection.commit()
        atomic_json(directory/'latest.json',snapshot)
        atomic_json(directory/'status.json',{'runId':snapshot['runId'],'status':'success','finishedAt':snapshot['capturedAt'],'games':len(games),'ranks':len(snapshot['ranks']),'reviewCoverage':snapshot['reviewCoverage'],'analysisVersion':snapshot['analysisVersion']})
    finally:
        connection.close()
    print('STEAM_REBUILD_OK',len(games),snapshot['reviewCoverage'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',type=pathlib.Path,required=True)
    args=parser.parse_args()
    with collector_lock(args.directory):
        rebuild(args.directory)
