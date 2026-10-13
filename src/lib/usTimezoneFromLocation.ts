// src/lib/usTimezoneFromLocation.ts
// Maps a free-text US location ("City, ST" or "City, State") to an IANA timezone.
// Hand-rolled, not a library: candidate locations are free text, not ZIP/lat-lng, so
// geo-coordinate packages (geo-tz, tz-lookup) don't match the input shape, and the only
// name-keyed package (city-timezones) has been unmaintained since ~2021 for a problem this
// small and auditable to own directly. A state-level table covers the vast majority of US
// locations correctly on its own; a small set of city/county-level overrides below covers
// every state that genuinely splits across timezones.
//
// Returns null (never a guess) when the location can't be confidently resolved - "Remote",
// empty text, a non-US location, or a city/state combination not recognized. Null is a real,
// reportable answer ("timezone could not be determined"), not a bug to silently paper over.

export interface TimezoneDerivationResult {
  timezone: string | null;
  /** Canonical 2-letter USPS abbreviation of the matched state, for display/debugging. */
  state: string | null;
}

// Canonical state data, keyed by 2-letter USPS abbreviation (lowercase). `names` lists every
// free-text spelling that should resolve to this state (full name, with/without punctuation).
// `timezone` is the state's majority zone; CITY_OVERRIDES corrects the known exceptions below
// by matching on the city portion first.
const STATES: Record<string, { names: string[]; timezone: string }> = {
  al: { names: ["alabama"], timezone: "America/Chicago" },
  ak: { names: ["alaska"], timezone: "America/Anchorage" },
  az: { names: ["arizona"], timezone: "America/Phoenix" }, // No DST, statewide (Navajo Nation portion is a known further exception - not handled, rare in this dataset)
  ar: { names: ["arkansas"], timezone: "America/Chicago" },
  ca: { names: ["california"], timezone: "America/Los_Angeles" },
  co: { names: ["colorado"], timezone: "America/Denver" },
  ct: { names: ["connecticut"], timezone: "America/New_York" },
  de: { names: ["delaware"], timezone: "America/New_York" },
  dc: { names: ["district of columbia", "washington dc", "washington d c"], timezone: "America/New_York" },
  fl: { names: ["florida"], timezone: "America/New_York" }, // Panhandle exception below
  ga: { names: ["georgia"], timezone: "America/New_York" },
  hi: { names: ["hawaii"], timezone: "Pacific/Honolulu" },
  id: { names: ["idaho"], timezone: "America/Denver" }, // North Idaho exception below
  il: { names: ["illinois"], timezone: "America/Chicago" },
  in: { names: ["indiana"], timezone: "America/New_York" }, // Several Central-time counties below
  ia: { names: ["iowa"], timezone: "America/Chicago" },
  ks: { names: ["kansas"], timezone: "America/Chicago" }, // A few western counties are Mountain; not handled, rare
  ky: { names: ["kentucky"], timezone: "America/New_York" }, // Western Kentucky exception below
  la: { names: ["louisiana"], timezone: "America/Chicago" },
  me: { names: ["maine"], timezone: "America/New_York" },
  md: { names: ["maryland"], timezone: "America/New_York" },
  ma: { names: ["massachusetts"], timezone: "America/New_York" },
  mi: { names: ["michigan"], timezone: "America/New_York" }, // Western Upper Peninsula exception below
  mn: { names: ["minnesota"], timezone: "America/Chicago" },
  ms: { names: ["mississippi"], timezone: "America/Chicago" },
  mo: { names: ["missouri"], timezone: "America/Chicago" },
  mt: { names: ["montana"], timezone: "America/Denver" },
  ne: { names: ["nebraska"], timezone: "America/Chicago" }, // Western panhandle exception below
  nv: { names: ["nevada"], timezone: "America/Los_Angeles" },
  nh: { names: ["new hampshire"], timezone: "America/New_York" },
  nj: { names: ["new jersey"], timezone: "America/New_York" },
  nm: { names: ["new mexico"], timezone: "America/Denver" },
  ny: { names: ["new york"], timezone: "America/New_York" },
  nc: { names: ["north carolina"], timezone: "America/New_York" },
  nd: { names: ["north dakota"], timezone: "America/Chicago" }, // Southwestern counties exception below
  oh: { names: ["ohio"], timezone: "America/New_York" },
  ok: { names: ["oklahoma"], timezone: "America/Chicago" },
  or: { names: ["oregon"], timezone: "America/Los_Angeles" }, // Malheur County exception below
  pa: { names: ["pennsylvania"], timezone: "America/New_York" },
  ri: { names: ["rhode island"], timezone: "America/New_York" },
  sc: { names: ["south carolina"], timezone: "America/New_York" },
  sd: { names: ["south dakota"], timezone: "America/Chicago" }, // Western counties exception below
  tn: { names: ["tennessee"], timezone: "America/Chicago" }, // Eastern Tennessee is Eastern time; not handled, most TN population is Central
  tx: { names: ["texas"], timezone: "America/Chicago" }, // El Paso & far-west exception below
  ut: { names: ["utah"], timezone: "America/Denver" },
  vt: { names: ["vermont"], timezone: "America/New_York" },
  va: { names: ["virginia"], timezone: "America/New_York" },
  wa: { names: ["washington"], timezone: "America/Los_Angeles" },
  wv: { names: ["west virginia"], timezone: "America/New_York" },
  wi: { names: ["wisconsin"], timezone: "America/Chicago" },
  wy: { names: ["wyoming"], timezone: "America/Denver" },
  pr: { names: ["puerto rico"], timezone: "America/Puerto_Rico" },
};

// city/county-name substring overrides, checked BEFORE the state default, for the states
// that genuinely split across two timezones. Matched against the lowercased, trimmed city
// portion of the input, keyed by the SAME canonical 2-letter abbreviation STATES uses.
// Deliberately narrow (well-known city names), not exhaustive county-boundary logic - good
// enough to catch the common real cases without false-positiving on an unrelated city that
// happens to share a word.
const CITY_OVERRIDES: { state: string; cityIncludes: string[]; timezone: string }[] = [
  { state: "tx", cityIncludes: ["el paso"], timezone: "America/Denver" },
  { state: "fl", cityIncludes: ["pensacola", "panama city", "fort walton beach", "destin", "crestview"], timezone: "America/Chicago" },
  { state: "in", cityIncludes: ["gary", "hammond", "east chicago", "evansville", "vincennes", "terre haute"], timezone: "America/Chicago" },
  { state: "ky", cityIncludes: ["paducah", "bowling green", "hopkinsville", "owensboro"], timezone: "America/Chicago" },
  { state: "mi", cityIncludes: ["ironwood", "wakefield", "bessemer"], timezone: "America/Chicago" },
  { state: "id", cityIncludes: ["coeur d'alene", "coeur dalene", "moscow", "sandpoint", "lewiston"], timezone: "America/Los_Angeles" },
  { state: "or", cityIncludes: ["ontario", "vale", "nyssa"], timezone: "America/Denver" },
  { state: "ne", cityIncludes: ["scottsbluff", "chadron", "alliance"], timezone: "America/Denver" },
  { state: "nd", cityIncludes: ["dickinson", "hettinger"], timezone: "America/Denver" },
  { state: "sd", cityIncludes: ["rapid city", "pierre", "spearfish"], timezone: "America/Denver" },
];

// Built once at module load: every recognized spelling (full name or abbreviation) -> the
// canonical 2-letter state key, so "Texas", "TX", and "tx." all resolve identically.
const STATE_KEY_LOOKUP: Record<string, string> = (() => {
  const lookup: Record<string, string> = {};
  for (const [abbr, { names }] of Object.entries(STATES)) {
    lookup[abbr] = abbr;
    for (const name of names) lookup[name] = abbr;
  }
  return lookup;
})();

const NON_LOCATION_PATTERN = /^(remote|n\/?a|unknown|tbd|various|anywhere)$/i;

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\./g, "");
}

export function deriveTimezoneFromLocation(rawLocation: string | null | undefined): TimezoneDerivationResult {
  const text = (rawLocation ?? "").trim();
  if (!text || NON_LOCATION_PATTERN.test(text)) return { timezone: null, state: null };

  // Expect "City, ST" or "City, State" (optionally with a trailing ", USA"/", US" segment, or
  // an embedded ZIP, e.g. "FL 33101" or "MI - 48212"). Walk segments from the end, skipping
  // anything that isn't a recognized state, to find the first one that resolves. Stops at
  // i=0 rather than i=1: a two-part "New Jersey, USA" has no separate city segment at all,
  // but the state alone is still enough to resolve a timezone (most states are single-zone).
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { timezone: null, state: null };

  for (let i = parts.length - 1; i >= 0; i--) {
    const segment = parts[i].replace(/[\s-]*\b\d{5}(-\d{4})?\b/, "").trim(); // drop an embedded/dash-prefixed ZIP
    const key = normalizeKey(segment);
    if (key === "usa" || key === "us" || key === "united states") continue;
    // Exact match first ("Texas", "TX"); fall back to a leading 2-letter-code match for a
    // messier segment the exact match misses (e.g. "MI" extracted from "MI - 48212" after
    // ZIP-stripping already handles the common case, this is a second line of defense for
    // anything that still has trailing noise after that).
    const prefixMatch = /^[a-z]{2}\b/.exec(key);
    const stateAbbr = STATE_KEY_LOOKUP[key] ?? (prefixMatch ? STATE_KEY_LOOKUP[prefixMatch[0]] : undefined);
    if (!stateAbbr) continue;

    const city = parts.slice(0, i).join(", ").toLowerCase();
    const override = CITY_OVERRIDES.find(
      (o) => o.state === stateAbbr && o.cityIncludes.some((name) => city.includes(name))
    );
    return { timezone: override?.timezone ?? STATES[stateAbbr].timezone, state: stateAbbr };
  }

  return { timezone: null, state: null };
}
