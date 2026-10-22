import { vi } from 'vitest';
import { AxiosError } from 'axios';

/** A 4xx axios error carrying the server's structured error body. */
export const apiError = (status: number, message: string, details?: { field: string; message: string }[]) =>
  new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    headers: {},
    config: {} as any,
    data: { success: false, error: { message, code: details ? 'VALIDATION_ERROR' : 'ERROR', details } },
  });

export const ok = (data: unknown = {}) => ({ data: { success: true, data } });

export const makeUserApiMock = () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  uploadProfilePhoto: vi.fn(),
  uploadCoverPhoto: vi.fn(),
  addWorkExperience: vi.fn(),
  updateWorkExperience: vi.fn(),
  deleteWorkExperience: vi.fn(),
  addEducation: vi.fn(),
  updateEducation: vi.fn(),
  deleteEducation: vi.fn(),
  updateSkills: vi.fn(),
});
