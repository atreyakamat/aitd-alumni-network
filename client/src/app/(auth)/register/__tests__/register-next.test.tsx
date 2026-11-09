import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, priority, ...props }: any) => <img {...props} />,
}));

const setAuthData = vi.fn();
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, setAuthData }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const register = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: { ...actual.authApi, register: (...args: unknown[]) => register(...args) },
  };
});

import RegisterPage from '@/app/(auth)/register/page';

const pick = async (trigger: string, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

/** What the server answers for a new registration (POST /auth/register). */
const created = {
  data: {
    success: true,
    data: {
      id: 'u1',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      approvalStatus: 'PENDING',
      message: 'Registration received. Verify your e-mail address with the link we sent you.',
    },
  },
};

const fill = async () => {
  await userEvent.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
  const year = String(new Date().getFullYear() - 5);
  await pick('Batch year', year);
  await pick('Degree', 'B.Tech');
  await pick('Department', 'Computer Science');
  await userEvent.type(screen.getByLabelText('Password'), 'Secret123!x');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'Secret123!x');
};

const fillAndSubmit = async () => {
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  toast.mockReset();
  setAuthData.mockReset();
  register.mockReset().mockResolvedValue(created);
});

describe('register `next` passthrough', { timeout: 20000 }, () => {
  it('links "Sign in" to login with the same safe return path', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<RegisterPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fevents%2F42');
  });

  it('keeps the return path on the sign-in link of the confirmation screen', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<RegisterPage />);
    await fillAndSubmit();

    const link = await screen.findByRole('link', { name: /go to sign in/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fevents%2F42');
  });

  it('drops unsafe return paths', async () => {
    search = new URLSearchParams('next=//evil.example.com');
    render(<RegisterPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await fillAndSubmit();
    expect(await screen.findByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('stays on the page and reports the error when registration fails', async () => {
    search = new URLSearchParams();
    register.mockRejectedValue({ response: { status: 409, data: { success: false, error: { message: 'Email already registered' } } } });
    render(<RegisterPage />);
    await fillAndSubmit();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Email already registered' }))
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(/what happens next/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });
});

describe('registration is a request that an administrator checks', { timeout: 20000 }, () => {
  beforeEach(() => {
    search = new URLSearchParams();
  });

  it('says on the form that an administrator checks every registration', async () => {
    render(<RegisterPage />);
    expect(await screen.findByText(/administrator checks every registration/i)).toBeInTheDocument();
  });

  it('offers the two optional fields that help the administrator, labelled for the applicant', async () => {
    render(<RegisterPage />);
    const enrolment = await screen.findByLabelText('Enrolment / roll number at the college (optional)');
    expect(enrolment).toHaveAttribute('maxlength', '50');
    const note = screen.getByLabelText('Anything that helps us verify you (optional)');
    expect(note.tagName).toBe('TEXTAREA');
    expect(note).toHaveAttribute('maxlength', '1000');
    expect(screen.getByText(/programme, year|a contact who knows you/i)).toBeInTheDocument();
  });

  it('counts the characters of the note', async () => {
    render(<RegisterPage />);
    const note = await screen.findByLabelText('Anything that helps us verify you (optional)');
    expect(screen.getByText('0 / 1000')).toBeInTheDocument();
    await userEvent.type(note, 'Batch 2019');
    expect(screen.getByText('10 / 1000')).toBeInTheDocument();
  });

  it('sends the enrolment number and the note with the registration, trimmed', async () => {
    render(<RegisterPage />);
    await userEvent.type(await screen.findByLabelText('Enrolment / roll number at the college (optional)'), '  AIEM/2019/042 ');
    await userEvent.type(screen.getByLabelText('Anything that helps us verify you (optional)'), ' B.Tech CS 2019, ask Prof. Rao ');
    await fillAndSubmit();

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@example.com',
          degree: 'B.Tech',
          enrollmentNumber: 'AIEM/2019/042',
          verificationNote: 'B.Tech CS 2019, ask Prof. Rao',
        })
      )
    );
  });

  it('leaves the optional fields out entirely when they stay empty', async () => {
    render(<RegisterPage />);
    await fillAndSubmit();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    const sent = register.mock.calls[0][0];
    expect(sent).not.toHaveProperty('enrollmentNumber');
    expect(sent).not.toHaveProperty('verificationNote');
  });

  it('does NOT sign in or leave for the dashboard: there is no session until an administrator approves', async () => {
    render(<RegisterPage />);
    await fillAndSubmit();
    await screen.findByText(/what happens next/i);

    expect(setAuthData).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('shows a "What happens next" screen with the three steps and a link to the login page', async () => {
    render(<RegisterPage />);
    await fillAndSubmit();

    expect(await screen.findByRole('heading', { name: /what happens next/i })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: /what happens next/i })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(/verify your e-mail/i);
    expect(steps[0]).toHaveTextContent('ada@example.com');
    expect(steps[1]).toHaveTextContent(/administrator checks that you are an alumnus/i);
    expect(steps[2]).toHaveTextContent(/e-mail when .*approved/i);
    expect(steps[2]).toHaveTextContent(/sign in/i);
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login');
    // the form is gone: a second click on "Create Account" cannot register the same person twice
    expect(screen.queryByRole('button', { name: 'Create Account' })).not.toBeInTheDocument();
  });

  it('shows the field message of the server next to the enrolment number', async () => {
    register.mockRejectedValue({
      response: {
        status: 400,
        data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'body.enrollmentNumber', message: 'Enrolment number is too long' }] } },
      },
    });
    render(<RegisterPage />);
    await fillAndSubmit();
    expect(await screen.findByText('Enrolment number is too long')).toBeInTheDocument();
  });
});
