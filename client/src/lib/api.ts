import axios from 'axios';

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
            message: error.response.data?.error || 'Server error. Please try again later.',
            status: error.response.status 
          } 
        }));
      }
      return Promise.reject(error);
    }

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(`${currentApiUrl}/auth/refresh-token`, {
            refreshToken,
          });

          const { accessToken, refreshToken: newRefreshToken } = response.data.data;

          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        if (isBrowser) {
          window.dispatchEvent(new CustomEvent('api:session_expired', { 
            detail: { message: 'Your session has expired. Please log in again.' } 
          }));
          window.location.href = '/login';
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

  me: () => api.get('/auth/me'),
};

// Type definitions for API requests
interface UserProfile {
  headline?: string;
  bio?: string;
  phone?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  locationCity?: string;
  locationCountry?: string;
  latitude?: number;
  longitude?: number;
  isPublicProfile?: boolean;
  showEmail?: boolean;
  showPhone?: boolean;
}

interface WorkExperience {
  companyName: string;
  title: string;
  employmentType?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
}

interface Education {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: number;
  endYear?: number;
  grade?: string;
  activities?: string;
  description?: string;
}

interface Post {
  content: string;
  visibility?: string;
  mediaUrls?: string[];
}

interface Job {
  title: string;
  company: string;
  location: string;
  type: string;
  experienceLevel?: string;
  salary?: string;
  description: string;
  requirements?: string;
  applicationUrl?: string;
  applicationEmail?: string;
  deadline?: string;
}

interface Event {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location?: string;
  isVirtual?: boolean;
  virtualLink?: string;
  maxAttendees?: number;
  coverImageUrl?: string;
}

interface MarketplaceListing {
  title: string;
  description: string;
  price: number;
  category: string;
  condition?: string;
  imageUrls?: string[];
  contactEmail?: string;
  contactPhone?: string;
}

interface DonationOrder {
  amount: number;
  currency?: string;
  donorName?: string;
  donorEmail?: string;
  message?: string;
  isAnonymous?: boolean;
  chapterId?: string;
}

// User API
export const userApi = {
  getProfile: (id: string) => api.get(`/users/${id}`),
  updateProfile: (data: UserProfile) => api.patch('/users/profile', data),
  getDirectory: (params?: { page?: number; limit?: number; search?: string; batchYear?: number; department?: string }) => 
    api.get('/users/directory', { params }),
  getYearbook: (year: number, department?: string) =>
    api.get(`/users/yearbook/${year}`, { params: { department } }),
  getStats: () => api.get('/users/stats'),
  getNotable: (limit?: number) => api.get('/users/notable', { params: { limit } }),
  getLocations: (params?: { north?: number; south?: number; east?: number; west?: number; limit?: number }) =>
    api.get('/users/locations', { params }),
  getNearby: (lat: number, lng: number, radius?: number) =>
    api.get('/users/nearby', { params: { lat, lng, radius } }),

  // Work experience
  addWorkExperience: (data: WorkExperience) => api.post('/users/work-experience', data),
  updateWorkExperience: (id: string, data: Partial<WorkExperience>) =>
    api.patch(`/users/work-experience/${id}`, data),
  deleteWorkExperience: (id: string) =>
    api.delete(`/users/work-experience/${id}`),

  // Education
  addEducation: (data: Education) => api.post('/users/education', data),
  updateEducation: (id: string, data: Partial<Education>) =>
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
  deleteComment: (id: string) => api.delete(`/comments/${id}`),
};

// Job API
export const jobApi = {
  getJobs: (params?: { page?: number; limit?: number; type?: string; location?: string; search?: string }) => 
    api.get('/jobs', { params }),
  getJob: (id: string) => api.get(`/jobs/${id}`),
  createJob: (data: Job) => api.post('/jobs', data),
  updateJob: (id: string, data: Partial<Job>) => api.patch(`/jobs/${id}`, data),
  deleteJob: (id: string) => api.delete(`/jobs/${id}`),
  getMyJobs: (page?: number, limit?: number) =>
    api.get('/jobs/my', { params: { page, limit } }),
};

// Event API
export const eventApi = {
  getEvents: (params?: { page?: number; limit?: number; type?: string; upcoming?: boolean }) => 
    api.get('/events', { params }),
  getEvent: (id: string) => api.get(`/events/${id}`),
  getUpcoming: (limit?: number) =>
    api.get('/events/upcoming', { params: { limit } }),
  createEvent: (data: Event) => api.post('/events', data),
  updateEvent: (id: string, data: Partial<Event>) => api.patch(`/events/${id}`, data),
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
  getNotifications: (page?: number, limit?: number, unreadOnly?: boolean) =>
    api.get('/notifications', { params: { page, limit, unread: unreadOnly } }),
  getUnreadCount: () => api.get('/notifications/unread'),
  markAsRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllAsRead: () => api.post('/notifications/read-all'),
  deleteNotification: (id: string) => api.delete(`/notifications/${id}`),
};

// Gallery API
export const galleryApi = {
  getAlbums: (page?: number, limit?: number, type?: string) =>
    api.get('/gallery/albums', { params: { page, limit, type } }),
  getAlbum: (id: string) => api.get(`/gallery/albums/${id}`),
  getRecentPhotos: (limit?: number) =>
    api.get('/gallery/recent', { params: { limit } }),
};

// News API
export const newsApi = {
  getArticles: (params?: any) => api.get('/news', { params }),
  getArticle: (slug: string) => api.get(`/news/${slug}`),
  getLatest: (limit?: number) => api.get('/news/latest', { params: { limit } }),
};

// Chapter API
export const chapterApi = {
  getChapters: (page?: number, limit?: number) =>
    api.get('/chapters', { params: { page, limit } }),
  getChapter: (id: string) => api.get(`/chapters/${id}`),
  getMyChapters: () => api.get('/chapters/my'),
  joinChapter: (id: string) => api.post(`/chapters/${id}/join`),
  leaveChapter: (id: string) => api.post(`/chapters/${id}/leave`),
  getMembers: (id: string, page?: number, limit?: number) =>
    api.get(`/chapters/${id}/members`, { params: { page, limit } }),
};

// Marketplace API
export const marketplaceApi = {
  getListings: (params?: { page?: number; limit?: number; category?: string; search?: string }) => 
    api.get('/marketplace', { params }),
  getListing: (id: string) => api.get(`/marketplace/${id}`),
  getCategories: () => api.get('/marketplace/categories'),
  getMyListings: () => api.get('/marketplace/my'),
  createListing: (data: MarketplaceListing) => api.post('/marketplace', data),
  updateListing: (id: string, data: Partial<MarketplaceListing>) =>
    api.patch(`/marketplace/${id}`, data),
  deleteListing: (id: string) => api.delete(`/marketplace/${id}`),
};

// Membership API
export const membershipApi = {
  getTiers: () => api.get('/memberships/tiers'),
  getTier: (id: string) => api.get(`/memberships/tiers/${id}`),
  getMyMembership: () => api.get('/memberships/my'),
  getHistory: () => api.get('/memberships/history'),
  createOrder: (tierId: string) =>
    api.post('/memberships/order', { tierId }),
  verifyPayment: (data: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => 
    api.post('/memberships/verify', data),
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
  createOrder: (data: DonationOrder) => api.post('/donations/order', data),
  verifyPayment: (data: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => 
    api.post('/donations/verify', data),
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
export const twoFactorApi = {
  verify2FA: (userId: string, otp: string) =>
    api.post('/auth/verify-2fa', { userId, otp }),
  resend2FA: (userId: string) =>
    api.post('/auth/resend-2fa', { userId }),
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
export const searchApi = {
  globalSearch: (query: string) => api.get('/search', { params: { q: query } }),
};

// Admin API
export const adminApi = {
  getStats: () => api.get('/admin/stats'),
  getAuditLogs: (params?: any) => api.get('/admin/audit', { params }),
  getRecentAuditActivity: (params?: any) => api.get('/admin/audit/activity', { params }),
  getEntityAuditHistory: (entityType: string, entityId: string) =>
    api.get(`/admin/audit/${entityType}/${entityId}`),
};

// Platform control API
export const platformApi = {
  getReadiness: () => api.get('/platform/readiness'),
};

export default api;
