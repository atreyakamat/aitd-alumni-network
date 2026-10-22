import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '' },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock('axios', () => {
  const create = vi.fn(() => mockInstance);
  return { default: { create, post: vi.fn() }, create };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { userApi } from '@/lib/api';

beforeEach(() => {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    mockInstance[method].mockReset().mockResolvedValue({ data: { success: true, data: {} } });
  }
});

describe('userApi profile endpoints', () => {
  it('uploads photos as multipart with the `photo` field', async () => {
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await userApi.uploadProfilePhoto(file);
    await userApi.uploadCoverPhoto(file);

    const [profileUrl, profileBody, profileConfig] = mockInstance.patch.mock.calls[0];
    expect(profileUrl).toBe('/users/profile-photo');
    expect(profileBody).toBeInstanceOf(FormData);
    expect((profileBody as FormData).get('photo')).toBe(file);
    expect(profileConfig.headers['Content-Type']).toBe('multipart/form-data');
    expect(mockInstance.patch.mock.calls[1][0]).toBe('/users/cover-photo');
  });

  it('hits the work-experience, education and skills routes', async () => {
    await userApi.addWorkExperience({ company: 'A', role: 'R', startDate: '2020-01-01' });
    await userApi.updateWorkExperience('w1', { role: 'R2' });
    await userApi.deleteWorkExperience('w1');
    await userApi.addEducation({ institution: 'AITD', degree: 'B.Tech', startYear: 2011 });
    await userApi.updateSkills(['Go']);

    expect(mockInstance.post).toHaveBeenCalledWith('/users/work-experience', expect.objectContaining({ startDate: '2020-01-01' }));
    expect(mockInstance.patch).toHaveBeenCalledWith('/users/work-experience/w1', { role: 'R2' });
    expect(mockInstance.delete).toHaveBeenCalledWith('/users/work-experience/w1');
    expect(mockInstance.post).toHaveBeenCalledWith('/users/education', expect.objectContaining({ startYear: 2011 }));
    expect(mockInstance.put).toHaveBeenCalledWith('/users/skills', { skills: ['Go'] });
  });
});
