"""Small real API contract check before a CI batch; no credentials."""
import json
import pathlib
from sources import Sources, STORE, parse_chart

source=Sources(pathlib.Path('work/probe'))
ranks,countries=parse_chart(source.get(STORE+'/charts/topselling/global?cc=US&l=english','global',False),'GLOBAL')
reviews=source.api('IUserReviewsService/GetAppReviews',{'appid':730,'languages':['all'],'filter':1,'num_per_page':1},'reviews')
assert len(ranks)>=80 and len(countries)>=25 and isinstance(reviews.get('reviews'),list)
print('PUBLIC_STEAM_PROBE_OK',len(ranks),'ranks',len(countries),'regions',len(reviews['reviews']),'review')
