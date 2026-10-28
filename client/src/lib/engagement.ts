import { api } from '@/lib/api';

const data = (res: { data?: { data?: unknown } }) => res.data?.data;
const seg = (id: string) => encodeURIComponent(id);
type Opts = { signal?: AbortSignal };

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasMore?: boolean;
}

export interface PersonLite {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  currentDesignation?: string | null;
  batchYear?: number | null;
}

// ---------------- College Requirements ----------------
export type RequirementCategory = 'HARDWARE' | 'SOFTWARE' | 'EXPERTISE' | 'SPONSORSHIP' | 'OTHER';
export type RequirementStatus = 'OPEN' | 'FULFILLED' | 'CLOSED';
export const REQUIREMENT_CATEGORIES: RequirementCategory[] = ['HARDWARE', 'SOFTWARE', 'EXPERTISE', 'SPONSORSHIP', 'OTHER'];

export interface RequirementResponse {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  user?: PersonLite;
}
export interface CollegeRequirement {
  id: string;
  title: string;
  description: string;
  category: RequirementCategory;
  status: RequirementStatus;
  createdAt: string;
  _count?: { responses: number };
  responses?: RequirementResponse[];
  hasResponded?: boolean;
}

export const requirementsApi = {
  list: async (params: { status?: string; category?: string; search?: string; page?: number; limit?: number } = {}, opts: Opts = {}) =>
    data(await api.get('/requirements', { params, signal: opts.signal })) as Paginated<CollegeRequirement>,
  get: async (id: string, opts: Opts = {}) => data(await api.get(`/requirements/${seg(id)}`, { signal: opts.signal })) as CollegeRequirement,
  create: async (input: { title: string; description: string; category: RequirementCategory }) =>
    data(await api.post('/requirements', input)) as CollegeRequirement,
  update: async (id: string, input: Partial<{ title: string; description: string; category: RequirementCategory; status: RequirementStatus }>) =>
    data(await api.patch(`/requirements/${seg(id)}`, input)) as CollegeRequirement,
  remove: (id: string) => api.delete(`/requirements/${seg(id)}`),
  respond: async (id: string, message: string) => data(await api.post(`/requirements/${seg(id)}/respond`, { message })),
  reviewResponse: async (responseId: string, accept: boolean) =>
    data(await api.post(`/requirements/responses/${seg(responseId)}/review`, { accept })),
};

// ---------------- Job Referrals ----------------
export type ReferralStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';
export interface Referrer {
  role: string;
  isCurrent: boolean;
  user: PersonLite;
}
export interface ReferralRequest {
  id: string;
  company: string;
  message: string;
  status: ReferralStatus;
  createdAt: string;
  requester?: PersonLite;
  target?: PersonLite;
  job?: { id: string; title: string; company: string } | null;
}

export const referralsApi = {
  findReferrers: async (company: string, opts: Opts = {}) =>
    (data(await api.get('/referrals/referrers', { params: { company }, signal: opts.signal })) as Referrer[]) ?? [],
  create: async (input: { targetId: string; company: string; message: string; jobId?: string | null }) =>
    data(await api.post('/referrals', input)) as ReferralRequest,
  received: async (params: { page?: number; limit?: number } = {}, opts: Opts = {}) =>
    data(await api.get('/referrals/received', { params, signal: opts.signal })) as Paginated<ReferralRequest>,
  sent: async (params: { page?: number; limit?: number } = {}, opts: Opts = {}) =>
    data(await api.get('/referrals/sent', { params, signal: opts.signal })) as Paginated<ReferralRequest>,
  respond: async (id: string, accept: boolean) => data(await api.post(`/referrals/${seg(id)}/respond`, { accept })) as ReferralRequest,
};

// ---------------- Weekly Digest (admin) ----------------
export interface DigestSections {
  nearbyAlumni: boolean;
  jobs: boolean;
  events: boolean;
  videos: boolean;
  requirements: boolean;
}
export interface DigestSettings {
  enabled: boolean;
  dayOfWeek: number;
  hour: number;
  sections: DigestSections;
  lastRunAt: string | null;
}

export const digestApi = {
  getSettings: async () => data(await api.get('/admin/digest')) as DigestSettings,
  updateSettings: async (input: Partial<Omit<DigestSettings, 'lastRunAt'>>) => data(await api.patch('/admin/digest', input)) as DigestSettings,
  sendNow: async () => data(await api.post('/admin/digest/send')) as { sent: number },
  sendTest: async () => data(await api.post('/admin/digest/test')) as { sent: number },
};

// ---------------- Landing Page Builder ----------------
export type LandingBlockType = 'HERO' | 'TEXT' | 'IMAGE' | 'STATS' | 'CTA' | 'HTML';
export interface LandingBlock {
  id: string;
  type: LandingBlockType;
  config: Record<string, unknown>;
  order: number;
  isPublished: boolean;
}

export const landingApi = {
  publicBlocks: async (opts: Opts = {}) => (data(await api.get('/landing', { signal: opts.signal })) as LandingBlock[]) ?? [],
  adminBlocks: async () => (data(await api.get('/admin/landing')) as LandingBlock[]) ?? [],
  create: async (input: { type: LandingBlockType; config: Record<string, unknown>; isPublished?: boolean }) =>
    data(await api.post('/admin/landing', input)) as LandingBlock,
  update: async (id: string, input: Partial<{ type: LandingBlockType; config: Record<string, unknown>; isPublished: boolean }>) =>
    data(await api.patch(`/admin/landing/${seg(id)}`, input)) as LandingBlock,
  remove: (id: string) => api.delete(`/admin/landing/${seg(id)}`),
  reorder: async (ids: string[]) => (data(await api.patch('/admin/landing/reorder', { ids })) as LandingBlock[]) ?? [],
};
