import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DeleteAccountDialog,
  isDeleteConfirmationValid,
  buildDeletePayload,
} from '@/components/settings/DeleteAccountDialog';

const renderDialog = (onConfirm = vi.fn().mockResolvedValue(undefined)) => {
  const onOpenChange = vi.fn();
  render(<DeleteAccountDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
  return { onConfirm, onOpenChange };
};

const submitButton = () => screen.getByRole('button', { name: /delete my account/i });

describe('delete confirmation rules', () => {
  it('password mode requires a non-blank password', () => {
    expect(isDeleteConfirmationValid('password', '', '')).toBe(false);
    expect(isDeleteConfirmationValid('password', '   ', '')).toBe(false);
    expect(isDeleteConfirmationValid('password', 'hunter2', '')).toBe(true);
  });

  it('confirm mode requires exactly DELETE', () => {
    expect(isDeleteConfirmationValid('confirm', '', 'delete')).toBe(false);
    expect(isDeleteConfirmationValid('confirm', '', 'DELET')).toBe(false);
    expect(isDeleteConfirmationValid('confirm', '', 'DELETE')).toBe(true);
    expect(isDeleteConfirmationValid('confirm', '', ' DELETE ')).toBe(true);
  });

  it('builds the matching API payload', () => {
    expect(buildDeletePayload('password', 'pw', '')).toEqual({ password: 'pw' });
    expect(buildDeletePayload('confirm', 'ignored', 'DELETE')).toEqual({ confirm: 'DELETE' });
  });
});

describe('<DeleteAccountDialog>', () => {
  it('keeps the delete button disabled until a password is entered', async () => {
    const { onConfirm } = renderDialog();
    expect(submitButton()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/current password/i), 'secret-pw');
    expect(submitButton()).toBeEnabled();
    await userEvent.click(submitButton());
    expect(onConfirm).toHaveBeenCalledWith({ password: 'secret-pw' });
  });

  it('supports OAuth accounts by typing DELETE', async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /google or linkedin/i }));
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();

    const confirmInput = screen.getByLabelText(/type delete to confirm/i);
    await userEvent.type(confirmInput, 'delete');
    expect(submitButton()).toBeDisabled();

    await userEvent.clear(confirmInput);
    await userEvent.type(confirmInput, 'DELETE');
    expect(submitButton()).toBeEnabled();
    await userEvent.click(submitButton());
    expect(onConfirm).toHaveBeenCalledWith({ confirm: 'DELETE' });
  });

  it('shows the server error message inline and keeps the dialog open', async () => {
    const onConfirm = vi.fn().mockRejectedValue({
      response: { data: { success: false, error: { message: 'Password is incorrect', code: 'INVALID_PASSWORD' } } },
    });
    const { onOpenChange } = renderDialog(onConfirm);
    await userEvent.type(screen.getByLabelText(/current password/i), 'wrong');
    await userEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables the button while the request is in flight', async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderDialog(onConfirm);
    await userEvent.type(screen.getByLabelText(/current password/i), 'pw');
    await userEvent.click(submitButton());
    expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
    resolve();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
