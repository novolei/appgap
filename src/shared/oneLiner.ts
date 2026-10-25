import { countryLabel } from "./catalog";
import { describeApp } from "./what";

function detectSubscription(description: string): boolean {
  return /subscription|subscribe|订阅|訂閱|課金|premium|pro plan|weekly|monthly|年額|月額/i.test(
    description,
  );
}

export function buildOneLiner(input: {
  name: string;
  description?: string | null;
  country?: string | null;
  rank?: number | null;
  genreId?: string | null;
}): string {
  const description = input.description ?? "";
  const described = describeApp(input.name, description, input.genreId);
  const bits: string[] = [described.what];
  if (detectSubscription(description) && /二维码|清理/.test(described.what)) {
    bits[0] = `${described.what}，靠订阅收费`;
  }

  if (input.rank === 1 && input.country) {
    bits.push(`${countryLabel(input.country)}畅销第一`);
  } else if (input.rank === 2 && input.country) {
    bits.push(`${countryLabel(input.country)}畅销第二`);
  }

  return bits.filter(Boolean).join("，");
}
