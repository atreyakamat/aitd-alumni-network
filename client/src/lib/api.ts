import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

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

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(`${API_URL}/auth/refresh-token`, {
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
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
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

// User API
export const userApi = {
  getProfile: (id: string) => api.get(`/users/${id}`),
  updateProfile: (data: any) => api.patch('/users/profile', data),
  getDirectory: (params?: any) => api.get('/users/directory', { params }),
  getYearbook: (year: number, department?: string) =>
    api.get(`/users/yearbook/${year}`, { params: { department } }),
  getStats: () => api.get('/users/stats'),
  getLocations: () => api.get('/users/locations'),

  // Work experience
  addWorkExperience: (data: any) => api.post('/users/work-experience', data),
  updateWorkExperience: (id: string, data: any) =>
    api.patch(`/users/work-experience/${id}`, data),
  deleteWorkExperience: (id: string) =>
    api.delete(`/users/work-experience/${id}`),

  // Education
  addEducation: (data: any) => api.post('/users/education', data),
  updateEducation: (id: string, data: any) =>
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
  createPost: (data: any) => api.post('/posts', data),
  updatePost: (id: string, data: any) => api.patch(`/posts/${id}`, data),
  deletePost: (id: string) => api.delete(`/posts/${id}`),
  likePost: (id: string) => api.post(`/posts/${id}/like`),
  addComment: (postId: string, content: string, parentId?: string) =>
    api.post(`/posts/${postId}/comments`, { content, parentId }),
  deleteComment: (id: string) => api.delete(`/comments/${id}`),
};

// Job API
export const jobApi = {
  getJobs: (params?: any) => api.get('/jobs', { params }),
  getJob: (id: string) => api.get(`/jobs/${id}`),
  createJob: (data: any) => api.post('/jobs', data),
  updateJob: (id: string, data: any) => api.patch(`/jobs/${id}`, data),
  deleteJob: (id: string) => api.delete(`/jobs/${id}`),
  getMyJobs: (page?: number, limit?: number) =>
    api.get('/jobs/my', { params: { page, limit } }),
};

// Event API
export const eventApi = {
  getEvents: (params?: any) => api.get('/events', { params }),
  getEvent: (id: string) => api.get(`/events/${id}`),
  getUpcoming: (limit?: number) =>
    api.get('/events/upcoming', { params: { limit } }),
  createEvent: (data: any) => api.post('/events', data),
  updateEvent: (id: string, data: any) => api.patch(`/events/${id}`, data),
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
  getListings: (params?: any) => api.get('/marketplace', { params }),
  getListing: (id: string) => api.get(`/marketplace/${id}`),
  getCategories: () => api.get('/marketplace/categories'),
  getMyListings: () => api.get('/marketplace/my'),
  createListing: (data: any) => api.post('/marketplace', data),
  updateListing: (id: string, data: any) =>
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
  verifyPayment: (data: any) => api.post('/memberships/verify', data),
};

// Donation API
export const donationApi = {
  getDonorsWall: (page?: number, limit?: number) =>
    api.get('/donations/wall', { params: { page, limit } }),
  getFeaturedDonors: () => api.get('/donations/featured'),
  getChapterDonations: () => api.get('/donations/chapters'),
  getStats: () => api.get('/donations/stats'),
  getMyDonations: () => api.get('/donations/my'),
  createOrder: (data: any) => api.post('/donations/order', data),
  verifyPayment: (data: any) => api.post('/donations/verify', data),
};

export default api;
