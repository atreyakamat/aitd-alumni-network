import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, ok } from './mocks';

const toast = vi.hoisted(() => vi.fn());
const userApi = vi.hoisted(() => ({
  addWorkExperience: vi.fn(),
  updateWorkExperience: vi.fn(),
  deleteWorkExperience: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
}));

import { WorkExperienceSection } from '@/components/profile/WorkExperienceSection';

const rows = [
  {
    id: 'w1',
    company: 'Acme',
    role: 'Engineer',
    location: 'Pune',
    startDate: '2019-07-01T00:00:00.000Z',
    endDate: '2021-06-01T00:00:00.000Z',
    isCurrent: false,
    description: null,
  },
];

beforeEach(() => {
  toast.mockReset();
  userApi.addWorkExperience.mockReset().mockResolvedValue(ok({ id: 'w2' }));
  userApi.updateWorkExperience.mockReset().mockResolvedValue(ok({ id: 'w1' }));
  userApi.deleteWorkExperience.mockReset().mockResolvedValue(ok());
});

const dialog = () => screen.getByRole('dialog');

describe('<WorkExperienceSection>', () => {
  it('lists roles with month ranges', () => {
    render(<WorkExperienceSection experiences={rows} onSaved={vi.fn()} />);
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Jul 2019 - Jun 2021')).toBeInTheDocument();
  });

  it('adds a current role with a date-only start and no end date', async () => {
    const onSaved = vi.fn();
    render(<WorkExperienceSection experiences={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add experience' }));

    await userEvent.type(within(dialog()).getByLabelText('Company'), 'Globex');
    await userEvent.type(within(dialog()).getByLabelText('Role'), 'Product Manager');
    fireEvent.change(within(dialog()).getByLabelText('Start month'), { target: { value: '2022-03' } });
    fireEvent.change(within(dialog()).getByLabelText('End month'), { target: { value: '2023-01' } });
    await userEvent.click(within(dialog()).getByLabelText('I currently work here'));
    expect(within(dialog()).getByLabelText('End month')).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add experience' }));

    await waitFor(() =>
      expect(userApi.addWorkExperience).toHaveBeenCalledWith({
        company: 'Globex',
        role: 'Product Manager',
        location: null,
        startDate: '2022-03-01',
        endDate: null,
        isCurrent: true,
        description: null,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Experience added' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSaved).toHaveBeenCalled();
  });

  it('validates required fields and date order before calling the API', async () => {
    render(<WorkExperienceSection experiences={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add experience' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add experience' }));

    expect(within(dialog()).getByText('Company is required')).toBeInTheDocument();
    expect(within(dialog()).getByText('Role is required')).toBeInTheDocument();
    expect(within(dialog()).getByText('Start month is required')).toBeInTheDocument();

    await userEvent.type(within(dialog()).getByLabelText('Company'), 'Globex');
    await userEvent.type(within(dialog()).getByLabelText('Role'), 'PM');
    fireEvent.change(within(dialog()).getByLabelText('Start month'), { target: { value: '2022-03' } });
    fireEvent.change(within(dialog()).getByLabelText('End month'), { target: { value: '2021-01' } });
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add experience' }));

    expect(within(dialog()).getByText('End month cannot be before start month')).toBeInTheDocument();
    expect(userApi.addWorkExperience).not.toHaveBeenCalled();
  });

  it('edits an existing role with its values pre-filled', async () => {
    render(<WorkExperienceSection experiences={rows} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Engineer at Acme' }));

    expect(within(dialog()).getByLabelText('Company')).toHaveValue('Acme');
    expect(within(dialog()).getByLabelText('Start month')).toHaveValue('2019-07');
    expect(within(dialog()).getByLabelText('End month')).toHaveValue('2021-06');

    const role = within(dialog()).getByLabelText('Role');
    await userEvent.clear(role);
    await userEvent.type(role, 'Senior Engineer');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(userApi.updateWorkExperience).toHaveBeenCalledWith(
        'w1',
        expect.objectContaining({ role: 'Senior Engineer', startDate: '2019-07-01', endDate: '2021-06-01', isCurrent: false })
      )
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Experience updated' });
  });

  it('keeps the dialog open and shows the server message when saving fails', async () => {
    userApi.updateWorkExperience.mockRejectedValue(apiError(404, 'Work experience not found'));
    render(<WorkExperienceSection experiences={rows} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Engineer at Acme' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', description: 'Work experience not found' })
      )
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    const onSaved = vi.fn();
    render(<WorkExperienceSection experiences={rows} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Engineer at Acme' }));

    expect(within(dialog()).getByText(/Engineer at Acme will be removed/)).toBeInTheDocument();
    expect(userApi.deleteWorkExperience).not.toHaveBeenCalled();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(userApi.deleteWorkExperience).toHaveBeenCalledWith('w1'));
    expect(toast).toHaveBeenCalledWith({ title: 'Experience removed' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSaved).toHaveBeenCalled();
  });
});
