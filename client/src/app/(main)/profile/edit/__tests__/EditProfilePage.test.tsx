import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState = vi.hoisted(() => ({
  user: { id: 'me', fullName: 'Ada Alum', profileCompleteness: 55 } as any,
  refreshUser: vi.fn(),
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const userApi = vi.hoisted(() => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
}));

import EditProfilePage from '@/app/(main)/profile/edit/page';

const profile = {
  id: 'me',
  fullName: 'Ada Alum',
  batchYear: 2015,
  department: 'CS',
  degree: 'B.E.',
  profilePhotoUrl: '/uploads/profiles/me.jpg',
  city: 'Pune',
  shortBio: '',
  phoneVisibility: 'PRIVATE',
  isLocationPublic: false,
  workExperiences: [],
  educations: [],
  skills: [],
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <EditProfilePage />
    </QueryClientProvider>
  );
  return { invalidate };
};

beforeEach(() => {
  toast.mockReset();
  authState.refreshUser.mockReset().mockResolvedValue(undefined);
  userApi.getProfile.mockReset().mockResolvedValue({ data: { success: true, data: profile } });
  userApi.updateProfile.mockReset().mockResolvedValue({ data: { success: true, data: profile } });
});

describe('Edit profile page', () => {
  it("loads the signed-in user's own profile and shows completeness hints", async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Edit profile' })).toBeInTheDocument();
    expect(userApi.getProfile).toHaveBeenCalledWith('me');
    expect(screen.getByTestId('completeness-score')).toHaveTextContent('55%');
    const checklist = screen.getByRole('list', { name: 'Profile checklist' });
    expect(checklist.querySelector('[data-done="false"]')).not.toBeNull();
    expect(screen.getByText('Link your LinkedIn profile')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Ada Alum');
  });

  it('refreshes the auth user and the profile query after a section saves', async () => {
    const { invalidate } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Save basic info' }));

    await waitFor(() => expect(authState.refreshUser).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile', 'me'] });
  });

  it('shows a retryable error when the profile cannot load', async () => {
    userApi.getProfile.mockRejectedValue({ response: { status: 500, data: { error: { message: 'Database down' } } } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database down');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
