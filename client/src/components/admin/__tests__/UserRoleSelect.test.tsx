import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserRoleSelect } from '@/components/admin/UserRoleSelect';

const optionLabels = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('<UserRoleSelect>', () => {
  it('offers ADMIN only MEMBER and CHAPTER_ADMIN for a member', () => {
    render(<UserRoleSelect actorRole="ADMIN" targetRole="MEMBER" userName="Ada" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /role for ada/i });
    expect(optionLabels(select)).toEqual(['Member', 'Chapter Admin']);
    expect(select).toHaveValue('MEMBER');
  });

  it('offers SUPER_ADMIN every role', () => {
    render(<UserRoleSelect actorRole="SUPER_ADMIN" targetRole="ADMIN" userName="Ada" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(optionLabels(select)).toEqual(['Member', 'Chapter Admin', 'Admin', 'Super Admin']);
    expect(select).toHaveValue('ADMIN');
  });

  it('is read-only when an ADMIN views a peer or superior', () => {
    const { rerender } = render(
      <UserRoleSelect actorRole="ADMIN" targetRole="ADMIN" userName="Ada" onChange={vi.fn()} />
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();

    rerender(<UserRoleSelect actorRole="ADMIN" targetRole="SUPER_ADMIN" userName="Ada" onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
  });

  it('is read-only for your own account, even as SUPER_ADMIN', () => {
    render(<UserRoleSelect actorRole="SUPER_ADMIN" targetRole="SUPER_ADMIN" isSelf userName="Me" onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTitle(/cannot change your own role/i)).toBeInTheDocument();
  });

  it('is read-only for non-admin actors', () => {
    render(<UserRoleSelect actorRole="CHAPTER_ADMIN" targetRole="MEMBER" userName="Ada" onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('normalizes raw role strings from the API', () => {
    render(<UserRoleSelect actorRole="superadmin" targetRole="chapter_admin" userName="Ada" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('CHAPTER_ADMIN');
  });

  it('calls onChange with the newly chosen role', async () => {
    const onChange = vi.fn();
    render(<UserRoleSelect actorRole="ADMIN" targetRole="MEMBER" userName="Ada" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CHAPTER_ADMIN');
    expect(onChange).toHaveBeenCalledWith('CHAPTER_ADMIN');
  });

  it('can be disabled while a mutation is pending', () => {
    render(<UserRoleSelect actorRole="ADMIN" targetRole="MEMBER" userName="Ada" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
