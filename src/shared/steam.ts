export type SteamRank = {
  country: string;
  chart: "sales" | "free" | "players";
  rank: number;
  appId: string;
  previousRank?: number | null;
  weeklyPriorRank?: number;
  weeks?: number;
  weekStart?: number | null;
  localPrice?: string;
  discountPct?: number;
  peakPlayers?: number;
};

export type SteamReview = {
  negativeRate30Days?: number | null;
  allSampleN: number;
  negativeInAllSample: number;
  negativeWilson95: [number, number] | null;
  matching30Days?: number;
  negativeMatching30Days?: number;
  negativeSampleN: number;
  languages: Record<string, number>;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  purchase?: {
    steam: number;
    external: number;
    receivedFree: number;
    refunded: number;
  };
  topics: { id: string; label: string; hits: number; denominator: number }[];
  evidence: {
    id: string;
    language: string;
    topics: string[];
    createdAt?: number;
    minutesAtReview?: number;
    excerpt: string;
    url: string;
    steamPurchase?: boolean;
    receivedForFree?: boolean;
    refunded?: boolean;
  }[];
};
export type SteamGame = {
  appId: string;
  name: string;
  free: boolean;
  subscription?: boolean;
  description: string;
  tags: string[];
  developers: string[];
  publishers: string[];
  priceUsd: number | null;
  priceOriginalUsd: number | null;
  discountPct: number;
  reviewCount: number;
  positivePct?: number;
  releaseTimestamp?: number;
  url: string;
  image?: string;
  reviews?: SteamReview;
  reviewError?: string;
  opportunity: {
    score: number;
    demand: number;
    pain: number;
    momentum: number | null;
    feasibility: number;
    confidence: string;
    regions: number;
    bestSalesRank: number | null;
    averageRankChange: number | null;
    changeComparisons: number;
  };
};
export type SteamSnapshot = {
  analysisVersion?: string;
  schemaVersion: number;
  runId: number;
  capturedAt: string;
  startedAt: string;
  date: string;
  reviewWindow: { start: number; end: number; days: number };
  countries: { id: string; name: string }[];
  games: Record<string, SteamGame>;
  ranks: SteamRank[];
  coverage: {
    country?: string;
    chart?: string;
    source?: string;
    status: string;
    rows?: number;
    error?: string;
    requested?: number;
    returned?: number;
    fullGames?: number;
  }[];
  sources: {
    label: string;
    url: string;
    fetchedAt: string;
    sha256: string;
    bytes: number;
  }[];
  reviewCoverage: { targeted: number; succeeded: number };
};
export type SteamWindow = {
  id: string;
  title: string;
  proposition: string;
  risk: string;
  prototype: string;
  validation: string;
  n: number;
  regionN: number;
  negativeN: number;
  score: number;
  priceMedian: number | null;
  rising: number;
  examples: string[];
  pains: { label: string; hits: number; denominator: number }[];
};
export type SteamView = {
  comparisonDates: string[];
  momentumUsable: boolean;
  capturedAt: string;
  runId: number;
  country: string;
  countries: SteamSnapshot["countries"];
  tags: string[];
  coverage: SteamSnapshot["coverage"];
  reviewCoverage: SteamSnapshot["reviewCoverage"];
  totalGames: number;
  games: (Omit<SteamGame, "reviews"> & {
    sampleN: number;
    negativeSampleN: number;
    topics: SteamReview["topics"];
    positions: SteamRank[];
  })[];
  windows: SteamWindow[];
  matrix: {
    country: string;
    n: number;
    cells: {
      tag: string;
      n: number;
      denominator: number;
      index: number | null;
    }[];
  }[];
  matrixTags: string[];
  summary: {
    n: number;
    paid: number;
    free: number;
    discounted: number;
    recentReleases: number;
    medianPrice: number | null;
    reviewSampleN: number;
    negativeSampleN: number;
    rising: number;
    compared: number;
  };
  genreStats: {
    tag: string;
    n: number;
    paid: number;
    priceMedian: number | null;
    rising: number;
    compared: number;
    regions: number;
    painHits: number;
    negativeN: number;
  }[];
  status: Record<string, unknown> | null;
};
