const SENIORITY_LEVELS: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  executive: 5,
};

const FX_TO_USD: Record<string, number> = {
  USD: 1,
  KES: 1 / 130,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.74,
  AUD: 0.66,
  INR: 0.012,
};

export interface MatchBreakdown {
  semantic: number;
  skills: number;
  title: number;
  location: number;
  seniority: number;
  salary: number;
}

export interface MatchScore {
  total: number;
  breakdown: MatchBreakdown;
}

export function semanticScore(cosine: number | null | undefined): number {
  if (cosine === null || cosine === undefined || !Number.isFinite(cosine)) return 0.5;
  return Math.min(1, Math.max(0, cosine));
}

export function skillOverlap(profileSkills: string[], required: string[], preferred: string[]): number {
  const profile = new Set(profileSkills.map((skill) => skill.trim().toLowerCase()));
  const requiredMatches = required.filter((skill) => profile.has(skill.trim().toLowerCase())).length;
  const preferredMatches = preferred.filter((skill) => profile.has(skill.trim().toLowerCase())).length;
  const denominator = required.length * 2 + preferred.length;
  if (denominator === 0) return 0.5;
  if (profileSkills.length === 0) return 0;
  return Math.min(1, Math.max(0, (requiredMatches * 2 + preferredMatches) / denominator));
}

export function titleSimilarity(desiredTitles: string[], jobTitle: string): number {
  if (desiredTitles.length === 0 || !jobTitle.trim()) return 0.5;
  return Math.max(...desiredTitles.map((title) => trigramSimilarity(title, jobTitle)), 0);
}

export function locationFit(profile: { locations?: string[]; remote?: boolean; openToRelocate?: boolean }, job: { location?: string | null; city?: string | null; country?: string | null; remote?: boolean; remoteType?: string | null }): number {
  const jobRemote = job.remote === true || job.remoteType === 'remote' || job.remoteType === 'hybrid';
  if (jobRemote) {
    if (profile.remote || profile.openToRelocate || (profile.locations ?? []).some((location) => /remote/i.test(location))) return 1;
    if ((profile.locations ?? []).length === 0) return 0.5;
    return 0.35;
  }
  if ((profile.locations ?? []).length === 0) return 0.5;
  const haystack = [job.location, job.city, job.country].filter(Boolean).join(' ').toLowerCase();
  if ((profile.locations ?? []).some((location) => haystack.includes(location.trim().toLowerCase()) || location.trim().toLowerCase().includes(haystack))) {
    return 1;
  }
  return profile.openToRelocate ? 0.6 : 0;
}

export function seniorityFit(profileSeniority: string | null | undefined, jobSeniority: string | null | undefined): number {
  if (!profileSeniority || !jobSeniority) return 0.5;
  const profileLevel = SENIORITY_LEVELS[profileSeniority.toLowerCase()];
  const jobLevel = SENIORITY_LEVELS[jobSeniority.toLowerCase()];
  if (profileLevel === undefined || jobLevel === undefined) return 0.5;
  return Math.max(0, 1 - Math.abs(profileLevel - jobLevel) / 5);
}

export function salaryFit(profileMin: number | null | undefined, profileMax: number | null | undefined, jobMin: number | null | undefined, jobMax: number | null | undefined, profileCurrency = 'KES', jobCurrency = 'KES'): number {
  if (profileMin === null || profileMin === undefined || profileMax === null || profileMax === undefined || jobMin === null || jobMin === undefined || jobMax === null || jobMax === undefined) {
    return 0.5;
  }
  const profileRate = FX_TO_USD[profileCurrency.toUpperCase()] ?? 1;
  const jobRate = FX_TO_USD[jobCurrency.toUpperCase()] ?? 1;
  const pMin = profileMin * profileRate;
  const pMax = profileMax * profileRate;
  const jMin = jobMin * jobRate;
  const jMax = jobMax * jobRate;
  const overlap = Math.max(0, Math.min(pMax, jMax) - Math.max(pMin, jMin));
  const span = Math.max(pMax, jMax) - Math.min(pMin, jMin);
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, overlap / span));
}

export function totalScore(input: {
  semantic: number | null | undefined;
  skills: { profile: string[]; required: string[]; preferred: string[] };
  title: { desired: string[]; job: string };
  location: { profile: { locations?: string[]; remote?: boolean; openToRelocate?: boolean }; job: { location?: string | null; city?: string | null; country?: string | null; remote?: boolean; remoteType?: string | null } };
  seniority: { profile: string | null | undefined; job: string | null | undefined };
  salary: { profileMin: number | null | undefined; profileMax: number | null | undefined; jobMin: number | null | undefined; jobMax: number | null | undefined; profileCurrency?: string; jobCurrency?: string };
}): MatchScore {
  const semantic = semanticScore(input.semantic);
  const skills = skillOverlap(input.skills.profile, input.skills.required, input.skills.preferred);
  const title = titleSimilarity(input.title.desired, input.title.job);
  const location = locationFit(input.location.profile, input.location.job);
  const seniority = seniorityFit(input.seniority.profile, input.seniority.job);
  const salary = salaryFit(input.salary.profileMin, input.salary.profileMax, input.salary.jobMin, input.salary.jobMax, input.salary.profileCurrency, input.salary.jobCurrency);

  const breakdown: MatchBreakdown = { semantic, skills, title, location, seniority, salary };
  const total = Math.round((semantic * 0.45 + skills * 0.25 + title * 0.1 + location * 0.1 + seniority * 0.05 + salary * 0.05) * 100);
  return { total: Math.min(100, Math.max(0, total)), breakdown };
}

function trigramSimilarity(left: string, right: string): number {
  const leftGrams = trigrams(left.toLowerCase());
  const rightGrams = trigrams(right.toLowerCase());
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
  let intersection = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) intersection += 1;
  return intersection / Math.max(leftGrams.size, rightGrams.size);
}

function trigrams(value: string): Set<string> {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < 3) return new Set(normalized ? [normalized] : []);
  const grams = new Set<string>();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}
