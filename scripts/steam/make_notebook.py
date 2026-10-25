"""Build a reproducible, offline companion notebook from an exported Steam snapshot."""
import pathlib
import nbformat as nbf

root = pathlib.Path(__file__).resolve().parents[2]
notebook = nbf.v4.new_notebook()
markdown = nbf.v4.new_markdown_cell
code = nbf.v4.new_code_cell
notebook.cells = [
markdown("""# Steam 机会研究 · 2026-10-25
## tl;dr
此笔记本重新计算公开榜单样本的地区、标签、价格、近期负评和内部排序敏感性；不调用网络或 AI。
最终结论见同目录中文研究报告。请先核对下面自动输出的数据时间和覆盖数。

## 决策、口径与假设
服务于独立开发者 / 小团队的下一款游戏原型选择。默认先用 2–3 周检验一个完整核心循环，预算与团队人数尚未由用户指定。
分析总体是公开畅销前 100 的地区联合样本，另有全球免费畅销 / 最常玩补样，不能代表 Steam 全量发行供给或成功概率。

## 输入与复现
输入为同目录 `steam-snapshot-2026-10-25.json`，可从新站完整 JSON 导出。每条源含请求 URL、时间和 SHA256；服务器原始响应保留 7 次采集。
使用 Python、pandas、matplotlib、nbformat、nbclient。离线执行本笔记本不会产生模型调用费用。"""),
code("""from pathlib import Path
import json, hashlib, math
from collections import Counter
from itertools import combinations
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display
root = Path.cwd()
path = root / 'steam-snapshot-2026-10-25.json'
snapshot = json.loads(path.read_text(encoding='utf-8'))
games = pd.DataFrame(snapshot['games'].values()).set_index('appId', drop=False)
ranks = pd.DataFrame(snapshot['ranks'])
sales = ranks[ranks.chart.eq('sales')].copy()
primary = games.loc[sorted(set(sales.appId))].copy()
plt.rcParams.update({'font.size':10, 'figure.dpi':130, 'axes.spines.top':False, 'axes.spines.right':False})
print('Snapshot:', snapshot['startedAt'], 'to', snapshot['capturedAt'])
print('Input SHA256:', hashlib.sha256(path.read_bytes()).hexdigest())
print('Catalog / sales union / ranks:', len(games), len(primary), len(ranks))
print('Review coverage:', snapshot['reviewCoverage'])
"""),
markdown("""## 数据质量与独立核对
粒度：每个日期 × 地区 × 榜单 × appid 一行。保留剔除 DLC 后的名次空缺。缺失评论不按零差评处理。
总体口碑是全球历史摘要；近期全体评论与额外负评有不同抽样分母。"""),
code("""assert snapshot['schemaVersion'] == 1
assert not ranks.duplicated(['country','chart','appId']).any()
assert not ranks.duplicated(['country','chart','rank']).any()
assert ranks['rank'].between(1,100).all()
assert set(ranks.appId).issubset(games.index)
assert all(g['type'] == 0 for g in snapshot['games'].values())
assert len(snapshot['countries']) == len({c['id'] for c in snapshot['countries']})
assert all(0 <= g.get('positivePct',0) <= 100 for g in snapshot['games'].values() if g.get('positivePct') is not None)
sample_n = negative_n = review_games = 0
for g in snapshot['games'].values():
    review = g.get('reviews')
    if not review: continue
    review_games += 1
    sample_n += review['allSampleN']; negative_n += review['negativeSampleN']
    assert 0 <= review['negativeInAllSample'] <= review['allSampleN'] <= 100
    assert len({r['id'] for r in review['evidence']}) == review['negativeSampleN']
    assert all(snapshot['reviewWindow']['start'] <= r['createdAt'] <= snapshot['reviewWindow']['end'] for r in review['evidence'])
    assert all(0 <= p['hits'] <= p['denominator'] == review['negativeSampleN'] for p in review['topics'])
assert review_games == snapshot['reviewCoverage']['succeeded']
print('PASS: unique grain, valid rank, metadata type, sample windows, review/topic denominators')
print('All-review samples / distinct negative evidence:', sample_n, negative_n)
display(pd.DataFrame(snapshot['coverage']).drop(columns=['source'],errors='ignore').fillna('').head(34))
"""),
markdown("""## 结果一：地区 × 类型
只取每款游戏前 6 个标签。热图为标签上榜游戏数 / 本地区有效游戏数，标签重叠；不能横向加总为市场份额。
与全球同榜的指数以 100 为基线，不代表国家规模。"""),
code("""tag_counts = Counter(t for tags in primary.tags for t in tags[:6])
top_tags = [t for t,n in tag_counts.most_common(12)]
country_counts = sales.groupby('country').appId.nunique()
matrix = pd.DataFrame(0.0,index=sorted(country_counts.index),columns=top_tags)
counts = matrix.copy()
for country in matrix.index:
    ids = set(sales.loc[sales.country.eq(country),'appId'])
    for tag in top_tags:
        counts.loc[country,tag] = sum(tag in games.loc[appid,'tags'][:6] for appid in ids)
        matrix.loc[country,tag] = counts.loc[country,tag]/len(ids)*100
fig,ax = plt.subplots(figsize=(14,10))
image = ax.imshow(matrix.values,aspect='auto',vmin=0,vmax=max(30,matrix.max().max()),cmap='YlGnBu')
ax.set_xticks(range(len(top_tags)),top_tags,rotation=45,ha='right')
ax.set_yticks(range(len(matrix)),[f'{c} (n={country_counts[c]})' for c in matrix.index])
ax.set_title('Tags among regional top-selling games (%) | overlapping tags, not sales share',loc='left',pad=14)
fig.colorbar(image,ax=ax,label='Share of sampled games (%)',shrink=.7)
fig.tight_layout(); fig.savefig(root/'regions-types.png',bbox_inches='tight'); plt.show()
index = matrix.div(matrix.loc['GLOBAL'].replace(0,float('nan')),axis=1)*100
display(index.round().head(12))
"""),
markdown("""## 结果二：付费信号与口碑
统一使用美国区现价；折扣会影响比较。免费游戏收入可能来自内购。评论数不是销量，整体好评率不是近期差评率。"""),
code("""genre_rows=[]
for tag in top_tags:
    group=primary[primary.tags.map(lambda tags:tag in tags[:6])]
    paid=group[~group.free]
    genre_rows.append({'tag':tag,'n':len(group),'paid':len(paid),'free':int(group.free.sum()),'median_paid_usd':paid.priceUsd.dropna().median(),'discounted':int((group.discountPct>0).sum()),'median_global_positive_pct':group.positivePct.dropna().median()})
genre=pd.DataFrame(genre_rows)
display(genre.round(1))
fig,(ax,price_ax)=plt.subplots(1,2,figsize=(14,5.5))
genre.sort_values('n').plot.barh(x='tag',y=['paid','free'],stacked=True,ax=ax,color=['#b8431f','#9bb497'])
ax.set(xlabel='Distinct sampled games',ylabel='',title='Monetisation signals by tag (overlapping)')
priced=primary[~primary.free & primary.priceUsd.notna() & primary.positivePct.notna()]
price_ax.scatter(priced.priceUsd,priced.positivePct,s=22,alpha=.55,color='#447464')
price_ax.set(xlabel='US current base price (USD)',ylabel='Global lifetime positive reviews (%)',title=f'Price and overall reception (n={len(priced)})')
fig.tight_layout();fig.savefig(root/'price-reception.png',bbox_inches='tight');plt.show()
"""),
markdown("""## 结果三：近期负评主题
下面是多语言关键词线索，可能误判／漏判，不作因果情绪标签。按每款额外负评去重后计主题，单条可命中多个主题。
英语、中文、日语、俄语及部分德／法／西／葡／韩等关键词覆盖不均，不能直接比较国家痛点发生率。"""),
code("""pain_counts=Counter(); pain_games=Counter()
for appid in primary.index:
    g=snapshot['games'][appid]
    for topic in (g.get('reviews') or {}).get('topics',[]):
        pain_counts[topic['id']]+=topic['hits'];pain_games[topic['id']]+=1
pain=pd.DataFrame([{'topic':key,'keyword_hits':value,'games_with_hit':pain_games[key]} for key,value in pain_counts.items()]).sort_values('keyword_hits')
fig,ax=plt.subplots(figsize=(10,4.5));ax.barh(pain.topic,pain.keyword_hits,color='#b8431f');ax.set(xlabel='Keyword-matching negative-review samples (non-exclusive)',title='Themes to inspect, not confirmed unmet needs');fig.tight_layout();fig.savefig(root/'negative-themes.png',bbox_inches='tight');plt.show()
display(pain.sort_values('keyword_hits',ascending=False))
"""),
markdown("""## 结果四：类型组合、排名变化与排序敏感性
标签组合必须有至少 5 款同样本游戏，lift 仅表示样本内共现，不能当因果或增长预测。
实时名次与可用周榜为不同时间口径，显示实际基线日期；没有自建历史时不绘制长期趋势。
内部优先级对权重进行敏感性检查，不把 0–100 分解释为成功率。"""),
code("""pairs=Counter(pair for tags in primary.tags for pair in combinations(sorted(set(tags[:6])),2))
pair_rows=[{'tag_a':a,'tag_b':b,'n':n,'sample_lift':n*len(primary)/(tag_counts[a]*tag_counts[b])} for (a,b),n in pairs.items() if n>=5]
pair_table=pd.DataFrame(pair_rows).sort_values(['sample_lift','n'],ascending=False)
display(pair_table.head(15).round(2))
baseline_dates=sorted({pd.to_datetime(t,unit='s',utc=True).date().isoformat() for t in sales.weekStart.dropna()})
comparable=sales[sales.previousRank.notna()].copy();comparable['change']=comparable.previousRank-comparable['rank']
print('Actual source baseline start dates:',baseline_dates,'; matched region/game pairs:',len(comparable))
weights={'balanced':(.3,.25,.2,.25),'scope_first':(.2,.15,.15,.5),'demand_first':(.5,.2,.2,.1)}
priorities=pd.DataFrame(index=primary.index)
for name,weight in weights.items():
    priorities[name]=primary.opportunity.map(lambda o:sum(v*w for v,w in zip([o['demand'],o['pain'],o['momentum'] or 0,o['feasibility']],weight)))
    weak=primary.opportunity.map(lambda o:o['confidence']=='初步线索')
    priorities.loc[weak,name]=priorities.loc[weak,name].clip(upper=60)
baseline_top=set(priorities.balanced.nlargest(20).index)
stability={name:len(baseline_top&set(priorities[name].nlargest(20).index)) for name in weights}
print('Top-20 overlap with balanced priorities:',stability)
display(primary.loc[priorities.balanced.nlargest(15).index,['name','priceUsd','tags']].assign(priority=priorities.balanced.round(1)))
"""),
markdown("""## 结论与下一步
把高需求、重复痛点和团队能交付的范围交叉检查，再选择原型；请结合配套中文报告的证据、反证和实验闸门。
先累计至少 14–28 天同口径历史，再判断持续上移。补充同标签失败／中位产品、真实试玩和目标玩家访谈；当前头部样本不足以给出回本概率。

## 来源与复核
官方定义与接口：[Top Sellers](https://partner.steamgames.com/doc/store/top_sellers)、[GetAppReviews](https://partner.steamgames.com/doc/webapi/IUserReviewsService)。
研究方法与采用理由见 `docs/steam-methodology.md`、`docs/steam-research-frameworks.md`。
下面输出可追踪的原始请求清单，完整内容保存为 sources.csv。"""),
code("""sources=pd.DataFrame(snapshot['sources'])
sources.to_csv(root/'sources.csv',index=False,encoding='utf-8-sig')
display(sources[['label','fetchedAt','sha256']].head(8))
metrics={'catalog':len(games),'salesUnion':len(primary),'ranks':len(ranks),'salesRows':len(sales),'allSampleN':sample_n,'negativeSampleN':negative_n,'reviewGames':review_games,'baselineDates':baseline_dates,'comparedRankPairs':len(comparable),'weightTop20Overlap':stability,'genre':json.loads(genre.round(2).to_json(orient='records')),'pain':pain.to_dict('records'),'pairs':pair_table.head(20).round(3).to_dict('records')}
(root/'analysis-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print('OFFLINE_VALIDATION_AND_ANALYSIS_OK')
"""),
]
notebook.metadata = {'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'},'language_info':{'name':'python','version':'3.14'}}
nbf.validate(notebook)
path = root/'reports'/'steam-analysis-2026-10-25.ipynb'
nbf.write(notebook,path)
print(path)
