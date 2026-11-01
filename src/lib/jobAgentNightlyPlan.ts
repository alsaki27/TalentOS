import {
  assertNightlyCombinedGroupPartition,
  getCombinedGroups,
  getNightlyDefaultGroups,
} from "@/lib/jobAgentRoleLibrary";
import {
  buildGoogleBooleanQuery,
  type ActorSource,
} from "@/lib/jobAgentActorContracts";

export const NIGHTLY_DATE_INTERVAL = "2 days" as const;

export interface NightlyJobAgentShard {
  shardKey: string;
  actorSource: ActorSource;
  roleGroups: string[];
  queries: string[];
  maxResults: number;
  dateInterval: typeof NIGHTLY_DATE_INTERVAL;
  googleQuery?: string;
}

/**
 * Build the immutable logical work matrix for one nightly batch:
 * 5 Indeed role bundles + 5 LinkedIn role bundles + 18 Google role groups.
 */
export function buildNightlyShardMatrix(roleGroupIds?: string[]): NightlyJobAgentShard[] {
  if (roleGroupIds?.length) {
    const requestedIds = [...new Set(roleGroupIds.map((id) => id.trim().toUpperCase()).filter(Boolean))];
    const available = new Map(getNightlyDefaultGroups().map((group) => [group.id, group]));
    const selected = requestedIds.map((id) => {
      const group = available.get(id);
      if (!group) throw new Error(`Role group ${id} is not enabled for nightly Job Agent searches.`);
      return group;
    });
    if (selected.length === 0) throw new Error("Select at least one role group for the nightly Job Agent run.");

    const scoped: NightlyJobAgentShard[] = selected.flatMap((group) => [
      {
        shardKey: `indeed:${group.id}`,
        actorSource: "indeed",
        roleGroups: [group.id],
        queries: [...group.titles],
        maxResults: 100,
        dateInterval: NIGHTLY_DATE_INTERVAL,
      },
      {
        shardKey: `linkedin:${group.id}`,
        actorSource: "linkedin",
        roleGroups: [group.id],
        queries: [...group.titles],
        maxResults: 150,
        dateInterval: NIGHTLY_DATE_INTERVAL,
      },
      {
        shardKey: `google:${group.id}`,
        actorSource: "google",
        roleGroups: [group.id],
        queries: [...group.titles],
        maxResults: 28,
        dateInterval: NIGHTLY_DATE_INTERVAL,
        googleQuery: buildGoogleBooleanQuery(group.titles),
      },
    ]);
    return scoped;
  }

  assertNightlyCombinedGroupPartition();

  const combinedGroups = getCombinedGroups();
  const defaultGroups = getNightlyDefaultGroups();

  const indeed = combinedGroups.map<NightlyJobAgentShard>((group) => ({
    shardKey: `indeed:${group.id}`,
    actorSource: "indeed",
    roleGroups: [...group.subGroupIds],
    queries: [...group.titles],
    maxResults: 100,
    dateInterval: NIGHTLY_DATE_INTERVAL,
  }));

  const linkedin = combinedGroups.map<NightlyJobAgentShard>((group) => ({
    shardKey: `linkedin:${group.id}`,
    actorSource: "linkedin",
    roleGroups: [...group.subGroupIds],
    queries: [...group.titles],
    maxResults: 150,
    dateInterval: NIGHTLY_DATE_INTERVAL,
  }));

  // 14 * 28 + 4 * 27 = exactly 500 Google results across A-R.
  const google = defaultGroups.map<NightlyJobAgentShard>((group, index) => ({
    shardKey: `google:${group.id}`,
    actorSource: "google",
    roleGroups: [group.id],
    queries: [...group.titles],
    maxResults: index < 14 ? 28 : 27,
    dateInterval: NIGHTLY_DATE_INTERVAL,
    googleQuery: buildGoogleBooleanQuery(group.titles),
  }));

  const matrix = [...indeed, ...linkedin, ...google];
  const shardKeys = new Set(matrix.map((shard) => shard.shardKey));
  if (matrix.length !== 28 || shardKeys.size !== matrix.length) {
    throw new Error(
      `Invalid nightly Job Agent matrix: expected 28 unique shards, got ${matrix.length} rows and ${shardKeys.size} unique keys.`,
    );
  }
  return matrix;
}
