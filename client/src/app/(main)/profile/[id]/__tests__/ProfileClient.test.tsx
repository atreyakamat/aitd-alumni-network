import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const authState = vi.hoisted(() => ({ user: { id: 'me' } as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const networkApi = vi.hoisted(() => ({ sendRequest: vi.fn() }));
const userApi = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  networkApi,
  userApi,
}));

// Follow bar and activity feed have their own tests (components/social/__tests__)
vi.mock('@/components/social/ProfileSocial', () => ({
  ProfileFollowBar: ({ canFollow }: { canFollow: boolean }) => <div data-testid="follow-bar" data-can-follow={String(canFollow)} />,
  ProfileActivity: () => <div data-testid="activity" />,
}));

import { ProfileClient } from '@/app/(main)/profile/[id]/ProfileClient';

const profile = { id: 'u2', fullName: 'Ravi Kumar', department: 'CS', batchYear: 2015, skills: [], workExperiences: [], educations: [] };

const renderProfile = (props: { profile: any; id: string }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileClient {...props} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  toast.mockReset();
  networkApi.sendRequest.mockReset().mockResolvedValue({ data: { success: true } });
  userApi.getProfile.mockReset().mockResolvedValue({ data: { success: true, data: profile } });
  authState.user = { id: 'me' };
});

describe('ProfileClient actions', () => {
  it('sends a connection request and marks it as sent', async () => {
    renderProfile({ profile, id: 'u2' });
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(networkApi.sendRequest).toHaveBeenCalledWith('u2'));
    expect(await screen.findByRole('button', { name: 'Request sent' })).toBeDisabled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connection request sent' }));
  });

  it('shows the server error when the request fails', async () => {
    networkApi.sendRequest.mockRejectedValue({
      response: { status: 409, data: { success: false, error: { message: 'Already connected' } } },
    });
    renderProfile({ profile, id: 'u2' });
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Already connected' }))
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('links your own profile to the profile editor', () => {
    authState.user = { id: 'u2' };
    renderProfile({ profile, id: 'u2' });
    expect(screen.getByRole('link', { name: /edit profile/i })).toHaveAttribute('href', '/profile/edit');
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });

  it('refetches the profile so edits and the personalised view show up', async () => {
    userApi.getProfile.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...profile,
          currentDesignation: 'Staff Engineer',
          linkedinUrl: 'https://linkedin.com/in/ravi',
          skills: [{ skill: { id: 's1', name: 'Go' } }],
          workExperiences: [
            { id: 'w1', company: 'Acme', role: 'Engineer', startDate: '2020-01-01T00:00:00.000Z', isCurrent: true },
          ],
          educations: [{ id: 'e1', institution: 'AITD', degree: 'B.Tech', startYear: 2011, endYear: 2015, isPrimary: true }],
        },
      },
    });
    renderProfile({ profile, id: 'u2' });

    expect(await screen.findByText('Staff Engineer')).toBeInTheDocument();
    expect(userApi.getProfile).toHaveBeenCalledWith('u2');
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://linkedin.com/in/ravi');
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Jan 2020 - Present')).toBeInTheDocument();
    expect(screen.getByText('AITD')).toBeInTheDocument();
    expect(screen.getByText('Go')).toBeInTheDocument();
  });

  it('never renders non-http links', async () => {
    userApi.getProfile.mockResolvedValue({
      data: { success: true, data: { ...profile, websiteUrl: 'javascript:alert(1)' } },
    });
    renderProfile({ profile, id: 'u2' });
    await waitFor(() => expect(userApi.getProfile).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Website' })).not.toBeInTheDocument();
  });

  it('shows the follow bar (with Follow only for other members) and the activity feed', () => {
    renderProfile({ profile, id: 'u2' });
    expect(screen.getByTestId('follow-bar')).toHaveAttribute('data-can-follow', 'true');
    expect(screen.getByTestId('activity')).toBeInTheDocument();
  });

  it('does not offer Follow on your own profile', () => {
    renderProfile({ profile: { ...profile, id: 'me' }, id: 'me' });
    expect(screen.getByTestId('follow-bar')).toHaveAttribute('data-can-follow', 'false');
  });
});
