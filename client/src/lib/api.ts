import axios from 'axios';
import type { Role } from '@/lib/roles';
import { buildLoginHref, isPublicPath } from '@/lib/public-paths';
import type { Notification as AppNotification } from '@/types';
import type { EducationInput, ProfileUpdatePayload, WorkExperienceInput } from '@/lib/profile';

const isBrowser = typeof window !== 'undefined';

const getApiUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (isBrowser) {
    const { hostname, origin } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocalHost ? 'http://localhost:5000/api' : `${origin}/api`;
  }

  return 'http://localhost:5000/api';
};

const getFallbackApiUrl = () => {
  // Only use fallback if explicitly configured via env var
  // This prevents auto-construction of non-existent DNS records like api.aitd.stixnvibes.com
  if (process.env.NEXT_PUBLIC_API_FALLBACK_URL) {
    return process.env.NEXT_PUBLIC_API_FALLBACK_URL;
  }
  return null;
};

let currentApiUrl = getApiUrl();

if (isBrowser) {
  const persistedApiUrl = window.localStorage.getItem('apiBaseUrlOverride');
  if (persistedApiUrl) {
    currentApiUrl = persistedApiUrl;
  }
}

export const api = axios.create({
  baseURL: currentApiUrl,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

const setApiBaseUrl = (baseUrl: string) => {
  currentApiUrl = baseUrl;
  api.defaults.baseURL = baseUrl;
  if (isBrowser) {
    window.localStorage.setItem('apiBaseUrlOverride', baseUrl);
  }
};

// ---------------------------------------------------------------------------
// Session refresh (single-flight)
// ---------------------------------------------------------------------------

/** Endpoints whose 401s mean "bad credentials", not "expired session". */
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh-token',
  '/auth/verify-2fa',
  '/auth/resend-2fa',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/oauth',
  '/auth/logout',
];

/** 401 codes that are about the request itself, not the access token. */
const NO_REFRESH_CODES = new Set([
  'INVALID_PASSWORD',
  'INVALID_CREDENTIALS',
  'INVALID_OTP',
  'INVALID_2FA_SESSION',
  'ACCOUNT_DEACTIVATED',
]);

export function shouldAttemptRefresh(url: unknown, body: any): boolean {
  const path = typeof url === 'string' ? url : '';
  if (NO_REFRESH_PATHS.some((p) => path.includes(p))) return false;
  const code = body?.error?.code;
  return !(typeof code === 'string' && NO_REFRESH_CODES.has(code));
}

let refreshPromise: Promise<string> | null = null;

/** How long a tab that lost a rotation race waits for the winner to store its tokens. */
const ROTATION_WAIT_MS = 2000;
const ROTATION_POLL_MS = 100;

/**
 * Another tab may have rotated the shared refresh token while our refresh was
 * in flight (the server rejects the loser with INVALID_REFRESH_TOKEN). If the
 * stored refresh token changed, adopt the winner's access token instead of
 * logging out. `wait` polls briefly, since the winner may not have stored its
 * response yet when ours fails.
 */
async function adoptRotatedSession(sentRefreshToken: string, wait: boolean): Promise<string | null> {
  const deadline = Date.now() + (wait ? ROTATION_WAIT_MS : 0);
  for (;;) {
    const latestRefresh = localStorage.getItem('refreshToken');
    // Logged out elsewhere: nothing to adopt
    if (!latestRefresh) return null;
    const latestAccess = localStorage.getItem('accessToken');
    if (latestRefresh !== sentRefreshToken && latestAccess) return latestAccess;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, ROTATION_POLL_MS));
  }
}

/**
 * Exchange the stored refresh token for a new token pair. Refresh tokens are
 * single-use (strict rotation), so concurrent callers share one in-flight
 * request instead of each spending the same token.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new Error('No refresh token');
      let response;
      try {
        // Raw axios (not `api`) so this call never re-enters the interceptors.
        response = await axios.post(`${currentApiUrl}/auth/refresh-token`, { refreshToken });
      } catch (error) {
        const lostRace = (error as any)?.response?.data?.error?.code === 'INVALID_REFRESH_TOKEN';
        const adopted = await adoptRotatedSession(refreshToken, lostRace);
        if (adopted) return adopted;
        throw error;
      }
      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      localStorage.setItem('accessToken', accessToken);
      if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);
      return accessToken as string;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const fallbackApiUrl = getFallbackApiUrl();
    const isGatewayFailure =
      error.response?.status === 502 ||
      error.response?.status === 503 ||
      error.response?.status === 504;
    const isHtml404 =
      error.response?.status === 404 &&
      typeof error.response?.headers?.['content-type'] === 'string' &&
      error.response.headers['content-type'].includes('text/html');

    const tryFailover = async () => {
      if (!isBrowser || !fallbackApiUrl || originalRequest?._apiFailoverTried) {
        return null;
      }
      if (currentApiUrl === fallbackApiUrl) {
        return null;
      }

      originalRequest._apiFailoverTried = true;
      setApiBaseUrl(fallbackApiUrl);
      originalRequest.baseURL = fallbackApiUrl;
      return api(originalRequest);
    };

    // Handle network errors
    if (!error.response) {
      const failoverResponse = await tryFailover();
      if (failoverResponse) return failoverResponse;

      console.error('Network error:', error.message);
      if (isBrowser) {
        window.dispatchEvent(new CustomEvent('api:network_error', { 
          detail: { message: 'Network error. Please check your connection.' } 
        }));
      }
      return Promise.reject(error);
    }

    if (isHtml404 || isGatewayFailure) {
      const failoverResponse = await tryFailover();
      if (failoverResponse) return failoverResponse;
    }

    // Handle 500 server errors
    if (error.response?.status >= 500) {
      console.error('Server error:', error.response.data);
      if (isBrowser) {
        window.dispatchEvent(new CustomEvent('api:server_error', { 
          detail: { 
            message: pickMessage(error.response.data) || 'Server error. Please try again later.',
            status: error.response.status 
          } 
        }));
      }
      return Promise.reject(error);
    }

    // 401: refresh the session once (single-flight) and retry the request.
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      shouldAttemptRefresh(originalRequest.url, error.response?.data)
    ) {
      originalRequest._retry = true;

      if (isBrowser && localStorage.getItem('refreshToken')) {
        try {
          const accessToken = await refreshAccessToken();
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch {
          // Refresh failed: the session is gone. Clear tokens and send to login.
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.dispatchEvent(new CustomEvent('api:session_expired', {
            detail: { message: 'Your session has expired. Please log in again.' }
          }));
          const { pathname, search } = window.location;
          if (isPublicPath(pathname)) {
            // Public sections stay browsable: reload so the page renders anonymously.
            window.location.href = `${pathname}${search}`;
          } else if (!pathname.startsWith('/login')) {
            window.location.href = buildLoginHref(`${pathname}${search}`);
          }
        }
      }
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      if (isBrowser) {
        window.dispatchEvent(new CustomEvent('api:forbidden', { 
          detail: { message: 'You do not have permission to perform this action.' } 
        }));
      }
    }

    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Shared response types & error helpers
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
}

export interface ApiErrorBody {
  success: false;
  error: { message: string; code?: string; details?: unknown } | string;
  message?: string;
}

const pickMessage = (body: any): string | null => {
  if (!body || typeof body !== 'object') return null;
  const { error, message } = body;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (typeof message === 'string' && message.trim()) return message;
  return null;
};

/**
 * Extract a user-facing message from an axios error. Handles the structured
 * `{ success:false, error:{ message, code } }` shape as well as legacy
 * `{ error: 'string' }` bodies (PRD §11: errors must be user-visible).
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as any;
  const fromBody = pickMessage(anyErr?.response?.data);
  if (fromBody) return fromBody;
  if (!anyErr?.response && anyErr instanceof Error && anyErr.message) return anyErr.message;
  return fallback;
}

/** The structured error code (e.g. 'VALIDATION_ERROR'), if any. */
export function getApiErrorCode(err: unknown): string | undefined {
  const error = (err as any)?.response?.data?.error;
  return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Field messages from a 400 VALIDATION_ERROR (`error.details: [{field, message}]`),
 * keyed by form field name ("body.password" → "password"). First message wins.
 */
export function getApiFieldErrors(err: unknown): Record<string, string> {
  const details = (err as any)?.response?.data?.error?.details;
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    if (!d || typeof d.message !== 'string') continue;
    const field = typeof d.field === 'string' ? d.field.replace(/^(body|query|params)\./, '') : '';
    if (field && !(field in out)) out[field] = d.message;
  }
  return out;
}

const readBlobText = (blob: Blob): Promise<string> => {
  if (typeof (blob as any).text === 'function') return (blob as any).text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
};

/** Like getApiErrorMessage, but also parses JSON error bodies of blob requests. */
export async function getApiErrorMessageAsync(err: unknown, fallback: string): Promise<string> {
  const data = (err as any)?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return pickMessage(JSON.parse(await readBlobText(data))) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return getApiErrorMessage(err, fallback);
}

/** Remove undefined / null / empty-string values from query params. */
const cleanParams = (params?: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
};

const seg = (id: string) => encodeURIComponent(id);

export interface PageOf<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Normalize a list response body. Current API: `{ data: T[], pagination }`;
 * legacy shapes `{ items, total, pages }` and bare arrays are also accepted.
 */
export function readPaginated<T = any>(body: any): PageOf<T> {
  if (Array.isArray(body)) return { items: body, total: body.length, page: 1, totalPages: 1 };
  const items: T[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : [];
  const p = body?.pagination ?? body ?? {};
  const total = Number(p.total ?? items.length) || 0;
  const page = Number(p.page ?? 1) || 1;
  const totalPages = Number(p.totalPages ?? p.pages ?? (items.length ? 1 : 0)) || 0;
  return { items, total, page, totalPages };
}

// Auth API
export const authApi = {
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    batchYear: number;
    department: string;
    degree: string;
    roleType?: string;
  }) => api.post('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),

  verifyEmail: (token: string) => api.post('/auth/verify-email', { token }),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),

  logout: (refreshToken?: string) =>
    api.post('/auth/logout', { refreshToken }),

  /** Signed-in password change; every other session is revoked and a fresh pair is returned. */
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post<ApiSuccess<{ accessToken: string; refreshToken: string; message?: string }>>('/auth/change-password', data),

  me: () => api.get('/auth/me'),
};

// Type definitions for API requests

/** Profile photo/cover upload: multipart field `photo` (5 MB, jpg/png/gif; see lib/profile). */
const photoForm = (file: File) => {
  const form = new FormData();
  form.append('photo', file);
  return form;
};

interface Post {
  content: string;
  visibility?: string;
  mediaUrls?: string[];
}

/** Mirrors the server's createJobSchema. */
export interface CreateJobInput {
  title: string;
  description: string;
  company: string;
  location?: string;
  workplaceType?: 'ONSITE' | 'REMOTE' | 'HYBRID';
  jobType?: 'FULL_TIME' | 'PART_TIME' | 'INTERNSHIP' | 'CONTRACT' | 'FREELANCE' | 'VOLUNTEER' | 'MENTORSHIP';
  industry?: string;
  salaryMin?: number;
  salaryMax?: number;
  experienceMin?: number;
  experienceMax?: number;
  skills?: string[];
  applicationLink?: string;
  deadline?: string;
}

/** Mirrors the server's createEventSchema. */
export interface CreateEventInput {
  title: string;
  description: string;
  bannerUrl?: string;
  eventType?: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  venue?: string;
  address?: string;
  city?: string;
  joinLink?: string;
  startDate: string;
  endDate?: string;
  capacity?: number;
  tags?: string[];
  isPublic?: boolean;
  chapterId?: string;
}

/**
 * POST /marketplace body (server: createMarketplaceListingSchema). Optional text fields
 * accept null / '' to clear them on PATCH. userId, viewCount and isFeatured are server-controlled.
 */
export interface MarketplaceListingInput {
  type?: import('@/types').MarketplaceListingType;
  title: string;
  category: string;
  description: string;
  location?: string | null;
  /** http(s) only. */
  website?: string | null;
  contactInfo?: string | null;
  priceRange?: string | null;
}

/**
 * PATCH /marketplace/:id body. Owners may pause (isActive: false) or resume a listing;
 * only admins may set isFeatured (the server ignores it from anyone else).
 */
export type MarketplaceListingUpdate = Partial<MarketplaceListingInput> & { isActive?: boolean; isFeatured?: boolean };

export interface MarketplaceListFilters {
  page?: number;
  limit?: number;
  type?: import('@/types').MarketplaceListingType;
  /** Exact category name from GET /marketplace/categories. */
  category?: string;
  location?: string;
  /** Matches title/description; server trims and caps at 100 chars. */
  search?: string;
}

/** POST /donations/order body (amount in rupees; server converts to paise). */
export interface DonationOrderInput {
  amount: number;
  chapterId?: string;
  isAnonymous?: boolean;
  dedicatedTo?: string;
  message?: string;
  /** Guests only (ignored for signed-in members): printed on, and used to e-mail, the receipt. */
  donorName?: string;
  donorEmail?: string;
}

/** Order returned by /donations/order and /memberships/order. `amount` is in paise. */
export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  transactionId?: string;
  [key: string]: unknown;
}

/** Fields Razorpay Checkout hands to the success handler; sent verbatim to the server. */
export interface RazorpayVerification {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export const NEARBY_MAX_RADIUS_KM = 500;
export const NEARBY_MAX_LIMIT = 200;

/** Server-side filters shared by the alumni map endpoints. */
export interface AlumniMapFilters {
  batchYear?: number;
  department?: string;
  search?: string;
}

/** Lets a caller cancel a superseded request (axios honours AbortSignal). */
export interface RequestOptions {
  signal?: AbortSignal;
}

// Only add `signal` when given so request configs stay minimal.
const signalOf = (options?: RequestOptions) => (options?.signal ? { signal: options.signal } : {});

// Geocoding (OpenStreetMap Nominatim, proxied and cached by the server). Answers 503
// GEOCODER_UNAVAILABLE when the operator disabled it or the upstream is unreachable.
export const geoApi = {
  search: (q: string, limit = 5, options?: RequestOptions) =>
    api.get('/geo/search', { params: { q, limit }, ...signalOf(options) }),
  reverse: (lat: number, lng: number, options?: RequestOptions) =>
    api.get('/geo/reverse', { params: { lat, lng }, ...signalOf(options) }),
};

// User API
export const userApi = {
  getProfile: (id: string) => api.get(`/users/${id}`),
  updateProfile: (data: ProfileUpdatePayload) => api.patch('/users/profile', data),
  // The instance defaults to JSON, which would make axios serialise FormData as JSON.
  uploadProfilePhoto: (file: File) =>
    api.patch('/users/profile-photo', photoForm(file), { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadCoverPhoto: (file: File) =>
    api.patch('/users/cover-photo', photoForm(file), { headers: { 'Content-Type': 'multipart/form-data' } }),
  getDirectory: (params?: { page?: number; limit?: number; search?: string; batchYear?: number; department?: string }) => 
    api.get('/users/directory', { params }),
  getYearbook: (year: number, department?: string) =>
    api.get(`/users/yearbook/${year}`, { params: { department } }),
  getStats: () => api.get('/users/stats'),
  getNotable: (limit?: number) => api.get('/users/notable', { params: { limit } }),
  /** `west > east` means the viewport crosses the antimeridian; the server handles it. */
  getLocations: (
    params?: {
      north?: number;
      south?: number;
      east?: number;
      west?: number;
      limit?: number;
    } & AlumniMapFilters,
    options?: RequestOptions
  ) => api.get('/users/locations', { params: cleanParams(params), ...signalOf(options) }),
  /** Server caps radius at 500 km and limit at 200; clamp so requests stay valid. */
  getNearby: (
    lat: number,
    lng: number,
    radius?: number,
    limit?: number,
    options?: RequestOptions & { filters?: AlumniMapFilters }
  ) =>
    api.get('/users/nearby', {
      params: cleanParams({
        lat,
        lng,
        radius: radius === undefined ? undefined : Math.min(Math.max(radius, 1), NEARBY_MAX_RADIUS_KM),
        limit: limit === undefined ? undefined : Math.min(Math.max(Math.floor(limit), 1), NEARBY_MAX_LIMIT),
        ...options?.filters,
      }),
      ...signalOf(options),
    }),

  // Work experience
  addWorkExperience: (data: WorkExperienceInput) => api.post('/users/work-experience', data),
  updateWorkExperience: (id: string, data: Partial<WorkExperienceInput>) =>
    api.patch(`/users/work-experience/${id}`, data),
  deleteWorkExperience: (id: string) =>
    api.delete(`/users/work-experience/${id}`),

  // Education
  addEducation: (data: EducationInput) => api.post('/users/education', data),
  updateEducation: (id: string, data: Partial<EducationInput>) =>
    api.patch(`/users/education/${id}`, data),
  deleteEducation: (id: string) => api.delete(`/users/education/${id}`),

  // Skills
  updateSkills: (skills: string[]) => api.put('/users/skills', { skills }),
};

// Post API
export const postApi = {
  getFeed: (page?: number, limit?: number) =>
    api.get('/posts', { params: { page, limit } }),
  getPost: (id: string) => api.get(`/posts/${id}`),
  createPost: (data: Post) => api.post('/posts', data),
  updatePost: (id: string, data: Partial<Post>) => api.patch(`/posts/${id}`, data),
  deletePost: (id: string) => api.delete(`/posts/${id}`),
  likePost: (id: string) => api.post(`/posts/${id}/like`),
  addComment: (postId: string, content: string, parentId?: string) =>
    api.post(`/posts/${postId}/comments`, { content, parentId }),
  /** Author-only on the server (admins may delete but not edit). */
  updateComment: (id: string, content: string) => api.patch(`/comments/${id}`, { content }),
  deleteComment: (id: string) => api.delete(`/comments/${id}`),
};

// Job API
export const jobApi = {
  getJobs: (params?: {
    page?: number;
    limit?: number;
    jobType?: string;
    type?: string;
    workplaceType?: string;
    location?: string;
    search?: string;
  }) =>
    api.get('/jobs', { params }),
  getJob: (id: string) => api.get(`/jobs/${id}`),
  /** Members' jobs go to PENDING_REVIEW; admins' are published directly (see `status` in the response). */
  createJob: (data: CreateJobInput) => api.post('/jobs', data),
  /** Editing a published job sends it back to review. */
  updateJob: (id: string, data: Partial<CreateJobInput>) => api.patch(`/jobs/${id}`, data),
  deleteJob: (id: string) => api.delete(`/jobs/${id}`),
  getMyJobs: (page?: number, limit?: number) =>
    api.get('/jobs/my', { params: { page, limit } }),
  /** ADMIN+ moderation. */
  approveJob: (id: string) => api.post(`/jobs/${seg(id)}/approve`),
  rejectJob: (id: string, reason: string) => api.post(`/jobs/${seg(id)}/reject`, { reason }),
};

// Event API
export const eventApi = {
  getEvents: (params?: { page?: number; limit?: number; type?: string; upcoming?: boolean }) => 
    api.get('/events', { params }),
  getEvent: (id: string) => api.get(`/events/${id}`),
  getUpcoming: (limit?: number) =>
    api.get('/events/upcoming', { params: { limit } }),
  /** ADMIN+, or CHAPTER_ADMIN when `chapterId` is the chapter they run. */
  createEvent: (data: CreateEventInput) => api.post('/events', data),
  updateEvent: (id: string, data: Partial<CreateEventInput>) => api.patch(`/events/${id}`, data),
  deleteEvent: (id: string) => api.delete(`/events/${id}`),
  rsvpEvent: (id: string) => api.post(`/events/${id}/rsvp`),
  getAttendees: (id: string) => api.get(`/events/${id}/attendees`),
};

// Network API
export const networkApi = {
  getConnections: (page?: number, limit?: number) =>
    api.get('/network/connections', { params: { page, limit } }),
  getPendingRequests: () => api.get('/network/requests'),
  getSuggestions: (limit?: number) =>
    api.get('/network/suggestions', { params: { limit } }),
  sendRequest: (userId: string) => api.post(`/network/request/${userId}`),
  respondToRequest: (id: string, accept: boolean) =>
    api.post(`/network/respond/${id}`, { accept }),
  removeConnection: (id: string) => api.delete(`/network/connection/${id}`),
};

// Message API
export const messageApi = {
  getConversations: (page?: number, limit?: number) =>
    api.get('/messages', { params: { page, limit } }),
  getMessages: (partnerId: string, page?: number, limit?: number) =>
    api.get(`/messages/${partnerId}`, { params: { page, limit } }),
  sendMessage: (receiverId: string, content: string, mediaUrl?: string) =>
    api.post(`/messages/${receiverId}`, { content, mediaUrl }),
  getUnreadCount: () => api.get('/messages/unread'),
  markAsRead: (partnerId: string) => api.post(`/messages/${partnerId}/read`),
};

// Notification API
export const notificationApi = {
  /** Paginated: `{ success, data: Notification[], pagination }`. */
  getNotifications: (page?: number, limit?: number, unreadOnly?: boolean) =>
    api.get<ApiPaginated<AppNotification>>('/notifications', {
      params: cleanParams({ page, limit, unread: unreadOnly ? 'true' : undefined }),
    }),
  getUnreadCount: () => api.get<ApiSuccess<{ unreadCount: number }>>('/notifications/unread'),
  markAsRead: (id: string) => api.post(`/notifications/${seg(id)}/read`),
  markAllAsRead: () => api.post('/notifications/read-all'),
  deleteNotification: (id: string) => api.delete(`/notifications/${seg(id)}`),
};

export type GalleryAlbumType = 'INSTITUTIONAL' | 'BATCH' | 'EVENT';

export interface CreateAlbumInput {
  title: string;
  description?: string;
  /** Defaults to INSTITUTIONAL. BATCH needs `batchYear`, EVENT needs `eventId`. */
  albumType?: GalleryAlbumType;
  batchYear?: number;
  eventId?: string;
  isPublic?: boolean;
}

// Gallery API
export const galleryApi = {
  /** Public albums, paginated. `search` matches title/description (server trims, caps at 100 chars). */
  getAlbums: (page?: number, limit?: number, type?: string, search?: string) =>
    api.get('/gallery/albums', { params: cleanParams({ page, limit, type, search }) }),
  getAlbum: (id: string) => api.get(`/gallery/albums/${seg(id)}`),
  getRecentPhotos: (limit?: number) =>
    api.get('/gallery/recent', { params: { limit } }),
  /** ADMIN+ only. */
  createAlbum: (data: CreateAlbumInput) => api.post('/gallery/albums', data),
};

// News API
export interface NewsListParams {
  page?: number;
  limit?: number;
  /** Server NewsCategory enum value (EVENT_RECAP | ALUMNI_STORY | INSTITUTE_UPDATE | NEWSLETTER). */
  category?: string;
  /** Matches title/excerpt/content (case-insensitive, server caps at 100 chars). */
  search?: string;
}

export const newsApi = {
  /** Public, PUBLISHED-only. Paginated `{ data, pagination }`. */
  getArticles: (params?: NewsListParams) => api.get('/news', { params: cleanParams(params) }),
  /** Public; accepts a slug or id. 404 NOT_FOUND for unknown/unpublished. */
  getArticle: (slug: string) => api.get(`/news/${seg(slug)}`),
  getLatest: (limit?: number) => api.get('/news/latest', { params: { limit } }),
};

export interface CreateChapterInput {
  name: string;
  region: string;
  description?: string;
  logoUrl?: string;
  adminUserId?: string;
}

export type UpdateChapterInput = Partial<Pick<CreateChapterInput, 'name' | 'region' | 'description' | 'logoUrl'>>;

export interface ChapterListFilters {
  /** Matches name/description (case-insensitive). */
  search?: string;
  /** Exact region. */
  region?: string;
}

// Chapter API
export const chapterApi = {
  /** Public. Server caps `limit` at 100. Response also carries `regions: string[]` (all active regions). */
  getChapters: (page?: number, limit?: number, filters?: ChapterListFilters) =>
    api.get('/chapters', { params: { page, limit, ...cleanParams(filters) } }),
  getChapter: (id: string) => api.get(`/chapters/${seg(id)}`),
  getMyChapters: () => api.get('/chapters/my'),
  joinChapter: (id: string) => api.post(`/chapters/${seg(id)}/join`),
  leaveChapter: (id: string) => api.post(`/chapters/${seg(id)}/leave`),
  getMembers: (id: string, page?: number, limit?: number) =>
    api.get(`/chapters/${seg(id)}/members`, { params: { page, limit } }),
  /** ADMIN+ only. */
  createChapter: (data: CreateChapterInput) => api.post('/chapters', data),
  /** CHAPTER_ADMIN of this chapter, or ADMIN+. */
  updateChapter: (id: string, data: UpdateChapterInput | Record<string, unknown>) => api.patch(`/chapters/${seg(id)}`, data),
  /** ADMIN+ only. */
  assignAdmin: (id: string, userId: string) => api.put(`/chapters/${seg(id)}/admin`, { userId }),
};

// Marketplace API
export const marketplaceApi = {
  /** Active listings, featured first. Paginated `{ data, pagination }`. */
  getListings: (params?: MarketplaceListFilters) => api.get('/marketplace', { params: cleanParams(params) }),
  /** Inactive listings 404 unless the caller is the owner or an admin. */
  getListing: (id: string) => api.get(`/marketplace/${seg(id)}`),
  getCategories: () => api.get('/marketplace/categories'),
  /** Caller's own listings, including paused ones (not paginated). */
  getMyListings: () => api.get('/marketplace/my'),
  createListing: (data: MarketplaceListingInput) => api.post('/marketplace', data),
  /** Owner (or admin) only. */
  updateListing: (id: string, data: MarketplaceListingUpdate) => api.patch(`/marketplace/${seg(id)}`, data),
  /** Owner (or admin) only. */
  deleteListing: (id: string) => api.delete(`/marketplace/${seg(id)}`),
};

// Membership API
export const membershipApi = {
  getTiers: () => api.get('/memberships/tiers'),
  getTier: (id: string) => api.get(`/memberships/tiers/${id}`),
  getMyMembership: () => api.get('/memberships/my'),
  /** Paginated: `{ success, data: [], pagination }`. */
  getHistory: (params?: { page?: number; limit?: number }) =>
    api.get<ApiPaginated<any>>('/memberships/history', { params: cleanParams(params) }),
  createOrder: (tierId: string) =>
    api.post<ApiSuccess<PaymentOrder>>('/memberships/order', { tierId }),
  verifyPayment: (data: RazorpayVerification) =>
    api.post('/memberships/verify', {
      razorpay_order_id: data.razorpay_order_id,
      razorpay_payment_id: data.razorpay_payment_id,
      razorpay_signature: data.razorpay_signature,
    }),
};

// Donation API
export const donationApi = {
  getDonorsWall: (page?: number, limit?: number) =>
    api.get('/donations/wall', { params: { page, limit } }),
  getLeaderboard: () => api.get('/donations/leaderboard'),
  getFeaturedDonors: () => api.get('/donations/featured'),
  getChapterDonations: () => api.get('/donations/chapters'),
  getStats: () => api.get('/donations/stats'),
  getMyDonations: () => api.get('/donations/my'),
  createOrder: (data: DonationOrderInput) =>
    api.post<ApiSuccess<PaymentOrder>>('/donations/order', cleanParams(data)),
  /** Only the Razorpay fields: every donation detail was stored server-side when the order was created. */
  verifyPayment: (data: RazorpayVerification) =>
    api.post(
      '/donations/verify',
      cleanParams({
        razorpay_order_id: data.razorpay_order_id,
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_signature: data.razorpay_signature,
      })
    ),
};

// Invite API
export const inviteApi = {
  sendInvite: (data: { email: string; name?: string; batchYear?: number; message?: string }) =>
    api.post('/invites/send', data),
  sendBulkInvites: (data: { invites: Array<{ email: string; name?: string; batchYear?: number }>; message?: string }) =>
    api.post('/invites/bulk', data),
  generateShareableLink: (batchYear?: number) =>
    api.post('/invites/generate-link', { batchYear }),
  getSentInvites: (page?: number, limit?: number) =>
    api.get('/invites/sent', { params: { page, limit } }),
  getStats: () => api.get('/invites/stats'),
  verifyInvite: (token: string) => api.get(`/invites/verify/${token}`),
  acceptInvite: (token: string) => api.post(`/invites/${token}/accept`),
};

// 2FA API
/** Returned by POST /auth/login when the account has 2FA enabled. */
export interface TwoFactorChallenge {
  requires2FA: true;
  userId: string;
  twoFactorToken: string;
  message?: string;
}

export const isTwoFactorChallenge = (data: any): data is TwoFactorChallenge =>
  !!data && data.requires2FA === true && typeof data.twoFactorToken === 'string';

export const twoFactorApi = {
  /** The user is resolved server-side from the signed challenge token. */
  verify2FA: (twoFactorToken: string, otp: string) =>
    api.post('/auth/verify-2fa', { twoFactorToken, otp }),
  resend2FA: (twoFactorToken: string) =>
    api.post('/auth/resend-2fa', { twoFactorToken }),
  enable2FA: () => api.post('/auth/2fa/enable'),
  disable2FA: () => api.post('/auth/2fa/disable'),
};

// Mentorship API
export const mentorshipApi = {
  // Mentor profiles
  getMentors: (params?: { page?: number; limit?: number; focusArea?: string; search?: string; available?: boolean }) =>
    api.get('/mentorship/mentors', { params }),
  getMentorProfile: (userId: string) => api.get(`/mentorship/profile/${userId}`),
  getMyMentorProfile: () => api.get('/mentorship/profile'),
  createMentorProfile: (data: { focusAreas: string[]; availability?: string; bio?: string; maxMentees?: number }) =>
    api.post('/mentorship/profile', data),
  updateMentorProfile: (data: { focusAreas?: string[]; availability?: string; bio?: string; maxMentees?: number; isActive?: boolean }) =>
    api.patch('/mentorship/profile', data),
  deleteMentorProfile: () => api.delete('/mentorship/profile'),
  
  // Mentorship requests
  requestMentorship: (mentorId: string, message?: string) =>
    api.post(`/mentorship/request/${mentorId}`, { message }),
  respondToRequest: (requestId: string, accept: boolean) =>
    api.post(`/mentorship/request/${requestId}/respond`, { accept }),
  getMyMentorRequests: (status?: string) =>
    api.get('/mentorship/requests/mentor', { params: { status } }),
  getMyMenteeRequests: (status?: string) =>
    api.get('/mentorship/requests/mentee', { params: { status } }),
  endMentorship: (requestId: string) =>
    api.post(`/mentorship/request/${requestId}/end`),
  
  // Sessions
  getSessions: (requestId: string) => api.get(`/mentorship/request/${requestId}/sessions`),
  scheduleSession: (requestId: string, data: { scheduledAt: Date; notes?: string }) =>
    api.post(`/mentorship/request/${requestId}/sessions`, data),
  completeSession: (sessionId: string, outcomes?: string) =>
    api.post(`/mentorship/sessions/${sessionId}/complete`, { outcomes }),
};

// Search API
export interface GlobalSearchResults {
  users: any[];
  jobs: any[];
  events: any[];
  posts: any[];
}

export const searchApi = {
  globalSearch: (query: string) =>
    api.get<ApiSuccess<GlobalSearchResults>>('/search', { params: { q: query } }),
};

// Admin API
export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  batchYear?: number | null;
  department?: string | null;
  roleType?: string | null;
  userRole: Role;
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface AdminUserFilters {
  search?: string;
  role?: Role | string;
  isActive?: boolean | 'true' | 'false';
  batchYear?: number | string;
  page?: number;
  limit?: number;
}

export interface PendingJob {
  id: string;
  title: string;
  companyName?: string;
  company?: string;
  location?: string | null;
  jobType?: string;
  type?: string;
  description?: string;
  createdAt: string;
  postedBy?: { id: string; fullName: string; email?: string; profilePhotoUrl?: string | null } | null;
  [key: string]: unknown;
}

export interface MentorshipOverview {
  mentors: { total: number; active: number };
  requests: {
    PENDING?: number;
    ACCEPTED?: number;
    DECLINED?: number;
    COMPLETED?: number;
    total: number;
  };
  sessions: { total: number; completed: number; completionRate: number };
}

export const EXPORT_ENTITIES = ['users', 'transactions', 'donations', 'jobs', 'events'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

// Audit log (PRD §6.10 / §8.4). Mirrors server/src/services/auditService.ts.
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'DEACTIVATE',
  'LOGIN',
  'LOGOUT',
  'PASSWORD_CHANGE',
  'SECURITY_ALERT',
  'ROLE_CHANGE',
  'BULK_INVITE',
  'EXPORT_DATA',
  'PAYMENT_MISMATCH',
  'CONTENT_REMOVED',
  'REPORT_DISMISSED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'POST',
  'JOB',
  'EVENT',
  'NEWS',
  'MEMBERSHIP',
  'DONATION',
  'CHAPTER',
  'GALLERY',
  'MARKETPLACE_ITEM',
  'INVITATION',
  'MENTORSHIP',
  'TRANSACTION',
  'SYSTEM',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Retention used by "Clean up old logs" (server DEFAULT_AUDIT_RETENTION_DAYS; floor is 30). */
export const AUDIT_RETENTION_DAYS = 365;

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  /** Acting user, resolved by the server; null for system entries or deleted accounts. */
  user?: { id: string; fullName: string; email: string } | null;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  /** ISO timestamps (inclusive). */
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogPage {
  success: true;
  logs: AuditLogEntry[];
  pagination: PaginationMeta;
}

export const adminApi = {
  getStats: () => api.get('/admin/stats'),
  listUsers: (filters?: AdminUserFilters) =>
    api.get<ApiPaginated<AdminUser>>('/admin/users', { params: cleanParams(filters) }),
  updateUserRole: (id: string, role: Role) =>
    api.patch<ApiSuccess<AdminUser>>(`/admin/users/${seg(id)}/role`, { role }),
  updateUserStatus: (id: string, isActive: boolean, reason?: string) =>
    api.patch<ApiSuccess<AdminUser>>(
      `/admin/users/${seg(id)}/status`,
      reason && reason.trim() ? { isActive, reason: reason.trim() } : { isActive }
    ),
  getPendingJobs: (params?: { page?: number; limit?: number }) =>
    api.get<ApiPaginated<PendingJob>>('/admin/jobs/pending', { params: cleanParams(params) }),
  getMentorshipOverview: () => api.get<ApiSuccess<MentorshipOverview>>('/admin/mentorship/overview'),
  /** CSV download; `response.data` is a Blob. */
  exportEntity: (entity: ExportEntity) =>
    api.get<Blob>(`/admin/export/${entity}`, { responseType: 'blob' }),
  getAuditLogs: (filters?: AuditLogFilters) =>
    api.get<AuditLogPage>('/admin/audit', { params: cleanParams(filters) }),
  getRecentAuditActivity: (params?: { limit?: number }) =>
    api.get<{ success: true; logs: AuditLogEntry[] }>('/admin/audit/activity', { params: cleanParams(params) }),
  getEntityAuditHistory: (entityType: string, entityId: string) =>
    api.get<{ success: true; logs: AuditLogEntry[] }>(`/admin/audit/${seg(entityType)}/${seg(entityId)}`),
  /** SUPER_ADMIN only. Deletes audit entries older than `daysToKeep` days (server floor: 30). */
  cleanupAuditLogs: (daysToKeep: number = AUDIT_RETENTION_DAYS) =>
    api.post<{ success: true; message: string; deletedCount: number }>('/admin/audit/cleanup', { daysToKeep }),
};

// Account self-service API (PRD §8.5)
export type DeleteAccountPayload = { password: string } | { confirm: 'DELETE' };

export const accountApi = {
  exportMyData: () =>
    api.get<ApiSuccess<Record<string, unknown> & { exportedAt: string }>>('/users/me/export'),
  deleteMyAccount: (payload: DeleteAccountPayload) => api.delete('/users/me', { data: payload }),
};

// Transactions API (PRD §6.8)
export interface Transaction {
  id: string;
  type: string;
  amount: number | string;
  currency: string;
  status: string;
  createdAt: string;
  receiptAvailable: boolean;
  memberships?: Array<{ tier?: { name?: string } | null }>;
  donations?: Array<{ id?: string; message?: string | null; chapter?: { name?: string } | null; [key: string]: unknown }>;
}

export const transactionApi = {
  getMyTransactions: (params?: { type?: string; status?: string; page?: number; limit?: number }) =>
    api.get<ApiPaginated<Transaction>>('/transactions/my', { params: cleanParams(params) }),
  /** PDF download; `response.data` is a Blob. */
  downloadReceipt: (id: string) =>
    api.get<Blob>(`/transactions/${seg(id)}/receipt`, { responseType: 'blob' }),
};

// Platform control API
export const platformApi = {
  getReadiness: () => api.get('/platform/readiness'),
};

export default api;
