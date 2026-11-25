/** The saved checkbox is authoritative. Older documents may only have an end date. */
type EmploymentStatus = { current?: unknown; isCurrent?: unknown; endDate?: unknown };

export function savedCurrentFlag(role?: EmploymentStatus | null): boolean | undefined {
  if (typeof role?.isCurrent === "boolean") return role.isCurrent;
  if (typeof role?.current === "boolean") return role.current;
}

export function isPresentEndDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "present";
}

export function employmentEndDate(value: string | null | undefined, selected: boolean): string | null {
  if (selected) return "Present";
  return isPresentEndDate(value) ? null : value || null;
}

export function currentExperienceIndex(roles: readonly (EmploymentStatus | null | undefined)[]): number {
  const selected = roles.findIndex(role => savedCurrentFlag(role) === true);
  if (selected >= 0) return selected;
  return roles.findIndex(role => savedCurrentFlag(role) === undefined && isPresentEndDate(role?.endDate));
}
