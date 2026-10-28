import type { AxiosProgressEvent } from 'axios';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SubmitterLite {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
}

export interface CollegeVideo {
  id: string;
  title: string;
  description?: string | null;
  videoUrl: string;
  thumbnailUrl?: string | null;
  category?: string | null;
  status: VideoStatus;
  viewCount: number;
  submittedById: string;
  submittedBy?: SubmitterLite | null;
  rejectionReason?: string | null;
  createdAt: string;
}

export interface Magazine {
  id: string;
  title: string;
  edition?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  fileUrl: string;
  isPublished: boolean;
  publishedAt: string;
  uploadedBy?: { id: string; fullName: string } | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasMore?: boolean;
}

// ---------------------------------------------------------------------------
// Upload validation (mirrors the server limits)
// ---------------------------------------------------------------------------

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const VIDEO_CATEGORIES = ['Campus', 'Convocation', 'Lectures', 'Student Life', 'Events', 'Achievements'] as const;

export function validateVideoFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return 'Choose an MP4, WebM or MOV video.';
  if (file.size > MAX_VIDEO_BYTES) return 'Videos can be at most 100 MB.';
  return null;
}

export function validatePdfFile(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) return 'Choose a PDF file.';
  if (file.size > MAX_PDF_BYTES) return 'The PDF can be at most 25 MB.';
  return null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const data = (res: { data?: { data?: unknown } }) => res.data?.data;
const seg = (id: string) => encodeURIComponent(id);
type Opts = { signal?: AbortSignal };
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export interface VideoInput {
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  category?: string;
}

export const videosApi = {
  list: async (
    params: { status?: VideoStatus; category?: string; search?: string; page?: number; limit?: number } = {},
    opts: Opts = {}
  ) => (data(await api.get('/videos', { params, signal: opts.signal })) as Paginated<CollegeVideo>),

  mine: async (params: { page?: number; limit?: number } = {}, opts: Opts = {}) =>
    data(await api.get('/videos/mine', { params, signal: opts.signal })) as Paginated<CollegeVideo>,

  get: async (id: string, opts: Opts = {}) => data(await api.get(`/videos/${seg(id)}`, { signal: opts.signal })) as CollegeVideo,

  uploadFile: async (file: File, onProgress?: (percent: number) => void): Promise<{ videoUrl: string; mimeType: string; size: number }> => {
    const form = new FormData();
    form.append('video', file);
    return data(
      await api.post('/videos/upload', form, {
        ...multipart,
        onUploadProgress: (e: AxiosProgressEvent) => {
          if (onProgress && e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        },
      })
    ) as { videoUrl: string; mimeType: string; size: number };
  },

  uploadThumbnail: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('image', file);
    return data(await api.post('/videos/upload-thumbnail', form, multipart)) as { url: string };
  },

  create: async (input: VideoInput) => data(await api.post('/videos', input)) as CollegeVideo,
  update: async (id: string, input: Partial<VideoInput>) => data(await api.patch(`/videos/${seg(id)}`, input)) as CollegeVideo,
  approve: async (id: string) => data(await api.post(`/videos/${seg(id)}/approve`)) as CollegeVideo,
  reject: async (id: string, reason?: string) => data(await api.post(`/videos/${seg(id)}/reject`, { reason })) as CollegeVideo,
  remove: (id: string) => api.delete(`/videos/${seg(id)}`),
};

export interface MagazineInput {
  title: string;
  edition?: string;
  description?: string;
  coverImageUrl?: string | null;
  fileUrl: string;
  isPublished?: boolean;
}

export const magazineApi = {
  list: async (params: { page?: number; limit?: number; all?: boolean } = {}, opts: Opts = {}) =>
    data(await api.get('/magazine', { params, signal: opts.signal })) as Paginated<Magazine>,

  get: async (id: string, opts: Opts = {}) => data(await api.get(`/magazine/${seg(id)}`, { signal: opts.signal })) as Magazine,

  uploadFile: async (file: File, onProgress?: (percent: number) => void): Promise<{ fileUrl: string }> => {
    const form = new FormData();
    form.append('file', file);
    return data(
      await api.post('/magazine/upload-file', form, {
        ...multipart,
        onUploadProgress: (e: AxiosProgressEvent) => {
          if (onProgress && e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        },
      })
    ) as { fileUrl: string };
  },

  uploadCover: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('image', file);
    return data(await api.post('/magazine/upload-cover', form, multipart)) as { url: string };
  },

  create: async (input: MagazineInput) => data(await api.post('/magazine', input)) as Magazine,
  update: async (id: string, input: Partial<MagazineInput>) => data(await api.patch(`/magazine/${seg(id)}`, input)) as Magazine,
  remove: (id: string) => api.delete(`/magazine/${seg(id)}`),
};
