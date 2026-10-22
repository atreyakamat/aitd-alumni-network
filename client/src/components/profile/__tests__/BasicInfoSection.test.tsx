import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, ok } from './mocks';

const toast = vi.hoisted(() => vi.fn());
const userApi = vi.hoisted(() => ({ updateProfile: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
}));

import { BasicInfoSection } from '@/components/profile/BasicInfoSection';
import { ContactLinksSection } from '@/components/profile/ContactLinksSection';

const profile = {
  id: 'me',
  fullName: 'Ada Alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  degree: 'B.E.',
  currentDesignation: 'Engineer',
  shortBio: '',
  linkedinUrl: 'https://linkedin.com/in/ada',
};

beforeEach(() => {
  toast.mockReset();
  userApi.updateProfile.mockReset().mockResolvedValue(ok());
});

describe('<BasicInfoSection>', () => {
  it('saves name, designation and bio (blank bio clears it) and refreshes', async () => {
    const onSaved = vi.fn();
    render(<BasicInfoSection profile={profile} onSaved={onSaved} />);

    const name = screen.getByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, '  Ada Lovelace ');
    await userEvent.clear(screen.getByLabelText('Current designation'));
    await userEvent.type(screen.getByLabelText('Current designation'), 'CTO at Engines');
    await userEvent.click(screen.getByRole('button', { name: 'Save basic info' }));

    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith({
        fullName: 'Ada Lovelace',
        currentDesignation: 'CTO at Engines',
        shortBio: null,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Basic info saved' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('shows a live bio counter and blocks bios over 500 characters', async () => {
    render(<BasicInfoSection profile={profile} onSaved={vi.fn()} />);
    const bio = screen.getByLabelText('Bio');
    await userEvent.click(bio);
    await userEvent.paste('x'.repeat(501));

    expect(screen.getByTestId('bio-counter')).toHaveTextContent('501/500');
    await userEvent.click(screen.getByRole('button', { name: 'Save basic info' }));
    expect(await screen.findByText(/at most 500 characters/)).toBeInTheDocument();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('shows department and batch read-only', () => {
    render(<BasicInfoSection profile={profile} onSaved={vi.fn()} />);
    expect(screen.getByText('Computer Engineering')).toBeInTheDocument();
    expect(screen.getByText('2015')).toBeInTheDocument();
    expect(screen.queryByLabelText(/department/i)).not.toBeInTheDocument();
  });

  it('surfaces server errors in a toast and inline', async () => {
    userApi.updateProfile.mockRejectedValue(
      apiError(400, 'Validation failed', [{ field: 'body.fullName', message: 'Name is too long' }])
    );
    const onSaved = vi.fn();
    render(<BasicInfoSection profile={profile} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save basic info' }));

    expect(await screen.findByText('Name is too long')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Could not save basic info', description: 'Validation failed' })
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('<ContactLinksSection>', () => {
  it('rejects links that are not full http(s) URLs before calling the API', async () => {
    render(<ContactLinksSection profile={profile} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('GitHub'), 'github.com/ada');
    await userEvent.type(screen.getByLabelText('Website'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact details' }));

    expect(await screen.findAllByText(/full link starting with https:\/\//)).toHaveLength(2);
    expect(screen.getByLabelText('GitHub')).toHaveAttribute('aria-invalid', 'true');
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('validates phone and secondary email', async () => {
    render(<ContactLinksSection profile={profile} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Phone number'), 'call me');
    await userEvent.type(screen.getByLabelText('Secondary email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact details' }));

    expect(await screen.findByText('Enter a valid phone number')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('sends trimmed links and clears blank ones with null', async () => {
    render(<ContactLinksSection profile={profile} onSaved={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('LinkedIn'));
    await userEvent.type(screen.getByLabelText('GitHub'), ' https://github.com/ada ');
    await userEvent.type(screen.getByLabelText('Phone number'), '+91 98765 43210');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact details' }));

    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith({
        phoneNumber: '+91 98765 43210',
        secondaryEmail: null,
        linkedinUrl: null,
        twitterUrl: null,
        githubUrl: 'https://github.com/ada',
        websiteUrl: null,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Contact details saved' });
  });
});
