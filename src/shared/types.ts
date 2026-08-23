import type { ChartId, GenreId, LensId } from "./catalog";

export type RankPosition = {
  country: string;
  chart: ChartId;
  genreId: GenreId | string;
  rank: number;
};

export type OpportunityRow = {
  lens: LensId;
  appId: string;
  name: string;
  nameZh: string;
  artistName: string;
  iconUrl: string | null;
  oneLiner: string;
  country: string;
  chart: ChartId;
  genreId: string;
  rank: number;
  rating: number | null;
  ratingCount: number | null;
  rankChange: number | null;
  consecutiveDays: number;
  trackViewUrl: string | null;
  score: number;
  positions: RankPosition[];
  reasons: string[];
};

export type ReviewItem = {
  rating: number | null;
  title: string;
  content: string;
  titleOriginal: string | null;
  contentOriginal: string | null;
  author: string;
  updated: string | null;
};

export type AppDetail = {
  app: {
    id: string;
    name: string;
    nameZh: string;
    artistName: string;
    artistId: string | null;
    iconUrl: string | null;
    description: string | null;
    oneLiner: string;
    genreName: string | null;
    formattedPrice: string | null;
    trackViewUrl: string | null;
  };
  positions: Array<RankPosition & { rating: number | null; ratingCount: number | null }>;
  history: Array<{ date: string; country: string; chart: string; genreId: string; rank: number }>;
  reviews: ReviewItem[];
  analysis: {
    headline: string;
    bullets: string[];
    pains: string[];
    move: string;
  };
  ai: { markdown: string; createdAt: string } | null;
};

export type MetaResponse = {
  lastSuccessAt: string | null;
  lastStatus: string | null;
  snapshotDate: string | null;
  ingesting: boolean;
  counts: Record<LensId, number>;
};

export type OpportunityListResponse = {
  lens: LensId;
  hint: string;
  snapshotDate: string | null;
  ingesting: boolean;
  items: OpportunityRow[];
};
