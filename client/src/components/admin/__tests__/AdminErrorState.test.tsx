import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminErrorState } from '@/components/admin/AdminErrorState';

describe('<AdminErrorState>', () => {
  it('says what failed, why, and offers a retry', async () => {
    const onRetry = vi.fn();
    render(<AdminErrorState title="Could not load members" message="The server did not answer." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Could not load members')).toBeInTheDocument();
    expect(screen.getByText('The server did not answer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('can label the button differently and disable it while retrying', () => {
    render(<AdminErrorState title="x" message="y" onRetry={vi.fn()} retryLabel="Try again" retrying />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
  });

  it('has no button when there is nothing to retry', () => {
    render(<AdminErrorState title="x" message="y" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
