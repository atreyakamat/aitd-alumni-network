import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
let mockSearchParams = new URLSearchParams('');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

const searchApi = vi.hoisted(() => ({
  globalSearch: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  searchApi,
}));

import SearchPage from '@/app/(main)/search/page';

describe('SearchPage (/search)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams('');
  });

  it('renders start searching prompt when query is empty', () => {
    render(<SearchPage />);
    expect(screen.getByText('Start searching')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a keyword to search for alumni, jobs, events or posts.')
    ).toBeInTheDocument();
  });

  it('performs global search and renders all tabs (people, jobs, events, posts)', async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams('q=engineer');

    searchApi.globalSearch.mockResolvedValueOnce({
      data: {
        data: {
          users: [
            {
              id: 'user-1',
              fullName: 'Elena Rostova',
              headline: 'Software Engineer',
              department: 'IT',
              batchYear: 2021,
            },
          ],
          jobs: [
            {
              id: 'job-1',
              title: 'Frontend Engineer',
              company: 'Vercel',
              location: 'Remote',
              type: 'FULL_TIME',
            },
          ],
          events: [
            {
              id: 'event-1',
              title: 'Alumni Tech Meetup',
              startDate: '2026-11-15T18:00:00.000Z',
              isVirtual: true,
            },
          ],
          posts: [
            {
              id: 'post-1',
              content: 'Excited about the future of software engineering!',
              user: { fullName: 'Alex Rivera' },
              createdAt: '2026-10-18T12:00:00.000Z',
            },
          ],
        },
      },
    });

    render(<SearchPage />);

    await waitFor(() => {
      expect(searchApi.globalSearch).toHaveBeenCalledWith('engineer');
    });

    // Check "All" tab summary
    expect(await screen.findByText('Elena Rostova')).toBeInTheDocument();
    expect(screen.getByText('Frontend Engineer')).toBeInTheDocument();
    expect(screen.getByText('Alumni Tech Meetup')).toBeInTheDocument();

    // Switch to Jobs tab
    const jobsTab = screen.getByRole('tab', { name: /Jobs/i });
    await user.click(jobsTab);
    expect(screen.getByText('Vercel')).toBeInTheDocument();

    // Switch to Events tab
    const eventsTab = screen.getByRole('tab', { name: /Events/i });
    await user.click(eventsTab);
    expect(screen.getByText('Alumni Tech Meetup')).toBeInTheDocument();

    // Switch to Posts tab
    const postsTab = screen.getByRole('tab', { name: /Posts/i });
    await user.click(postsTab);
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(
      screen.getByText('Excited about the future of software engineering!')
    ).toBeInTheDocument();
  });

  it('submits search form and updates URL', async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search alumni, jobs, events...');
    await user.type(input, 'robotics');

    const submitBtn = screen.getByRole('button', { name: /Search/i });
    await user.click(submitBtn);

    expect(push).toHaveBeenCalledWith('/search?q=robotics');
  });
});
