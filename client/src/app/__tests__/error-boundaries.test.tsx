import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MainError from '@/app/(main)/error';
import GlobalError from '@/app/global-error';
import RootError from '@/app/error';

const failure = Object.assign(new Error('render exploded: secret internals'), { digest: 'ref-8f3a21' });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ['the signed-in area', MainError],
  ['the whole app (root layout failure)', GlobalError],
  ['a public page', RootError],
])('error boundary for %s', (_label, Boundary) => {
  it('tells the member something went wrong without leaking the internals', () => {
    render(<Boundary error={failure} reset={() => undefined} />);
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.queryByText(/secret internals/i)).not.toBeInTheDocument();
  });

  it('lets them try again', async () => {
    const reset = vi.fn();
    render(<Boundary error={failure} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('shows the reference they can quote to support when the framework supplied one', () => {
    render(<Boundary error={failure} reset={() => undefined} />);
    expect(screen.getByText(/ref-8f3a21/)).toBeInTheDocument();
  });

  it('copes with an error that has no reference', () => {
    render(<Boundary error={new Error('plain')} reset={() => undefined} />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('reports the error to the console so it reaches monitoring', () => {
    render(<Boundary error={failure} reset={() => undefined} />);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('a way out', () => {
  it('the signed-in boundary links back to the dashboard', () => {
    render(<MainError error={failure} reset={() => undefined} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
  });

  it('the app-wide boundary links home', () => {
    render(<GlobalError error={failure} reset={() => undefined} />);
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});
