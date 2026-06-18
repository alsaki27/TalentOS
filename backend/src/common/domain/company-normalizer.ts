export function normalizeCompanyName(name: string | null | undefined) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function slugifyCompanyName(name: string) {
  return normalizeCompanyName(name).replace(/\s+/g, "-");
}
