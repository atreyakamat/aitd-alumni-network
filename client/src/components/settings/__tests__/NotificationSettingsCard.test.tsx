import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toast = vi.fn();
const getPreferences = vi.fn();
const updatePreferences = vi.fn();

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    notificationApi: {
      ...actual.notificationApi,
      getPreferences: (...args: unknown[]) => getPreferences(...args),
      updatePreferences: (...args: unknown[]) => updatePreferences(...args),
    },
  };
});

import { NotificationSettingsCard } from '@/components/settings/NotificationSettingsCard';

const CATEGORIES = ['CONNECTIONS', 'MESSAGES', 'POSTS_AND_COMMENTS', 'EVENTS', 'JOBS_AND_MENTORSHIP', 'ANNOUNCEMENTS'] as const;
const payload = (overrides: Record<string, { inApp?: boolean; email?: boolean }> = {}) => ({
  data: {
    data: {
      preferences: CATEGORIES.map((category) => ({ category, inApp: true, email: true, ...overrides[category] })),
      alwaysOn: ['ACCOUNT_AND_SECURITY'],
    },
  },
});

beforeEach(() => {
  toast.mockReset();
  getPreferences.mockReset();
  updatePreferences.mockReset();
});

describe('<NotificationSettingsCard>', () => {
  it('shows every category with an In-app and an E-mail checkbox, all on by default', async () => {
    getPreferences.mockResolvedValue(payload());
    render(<NotificationSettingsCard />);
    expect(await screen.findByRole('checkbox', { name: 'Messages: In-app' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Messages: E-mail' })).toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength((CATEGORIES.length + 1) * 2);
    expect(screen.getByRole('columnheader', { name: 'In-app' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeInTheDocument();
  });

  it('groups the settings in a labelled fieldset', async () => {
    getPreferences.mockResolvedValue(payload());
    render(<NotificationSettingsCard />);
    await screen.findByRole('checkbox', { name: 'Messages: In-app' });
    expect(screen.getByRole('group', { name: 'Notification settings' })).toBeInTheDocument();
  });

  it('shows what the member chose earlier', async () => {
    getPreferences.mockResolvedValue(payload({ MESSAGES: { inApp: false } }));
    render(<NotificationSettingsCard />);
    expect(await screen.findByRole('checkbox', { name: 'Messages: In-app' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Messages: E-mail' })).toBeChecked();
  });

  it('shows the account and security notices as always on, disabled, with the reason', async () => {
    getPreferences.mockResolvedValue(payload());
    render(<NotificationSettingsCard />);
    const inApp = await screen.findByRole('checkbox', { name: /account, security and payments: in-app/i });
    const email = screen.getByRole('checkbox', { name: /account, security and payments: e-mail/i });
    for (const box of [inApp, email]) {
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(screen.getByText(/cannot be switched off/i)).toBeInTheDocument();
  });

  it('saves a change with the category and channel only, and tells screen readers', async () => {
    getPreferences.mockResolvedValue(payload());
    updatePreferences.mockResolvedValue(payload({ EVENTS: { inApp: false } }));
    render(<NotificationSettingsCard />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Events: In-app' }));
    expect(updatePreferences).toHaveBeenCalledWith([{ category: 'EVENTS', inApp: false }]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Events, In-app: off. Saved/));
    expect(screen.getByRole('checkbox', { name: 'Events: In-app' })).not.toBeChecked();
  });

  it('can be used from the keyboard', async () => {
    getPreferences.mockResolvedValue(payload());
    updatePreferences.mockResolvedValue(payload({ CONNECTIONS: { email: false } }));
    render(<NotificationSettingsCard />);
    const box = await screen.findByRole('checkbox', { name: 'Connections and followers: E-mail' });
    box.focus();
    await userEvent.keyboard(' ');
    expect(updatePreferences).toHaveBeenCalledWith([{ category: 'CONNECTIONS', email: false }]);
  });

  it('puts the checkbox back and says so when saving fails', async () => {
    getPreferences.mockResolvedValue(payload());
    updatePreferences.mockRejectedValue(new Error('network'));
    render(<NotificationSettingsCard />);
    const box = await screen.findByRole('checkbox', { name: 'Messages: In-app' });
    await userEvent.click(box);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not save that setting', variant: 'destructive' })));
    expect(screen.getByRole('checkbox', { name: 'Messages: In-app' })).toBeChecked();
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    getPreferences.mockRejectedValueOnce(new Error('network')).mockResolvedValue(payload());
    render(<NotificationSettingsCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('checkbox', { name: 'Messages: In-app' })).toBeInTheDocument();
  });

  it('names each row by its category for assistive technology', async () => {
    getPreferences.mockResolvedValue(payload());
    render(<NotificationSettingsCard />);
    const row = (await screen.findByRole('rowheader', { name: /posts and comments/i })).closest('tr')!;
    expect(within(row).getAllByRole('checkbox')).toHaveLength(2);
  });
});
