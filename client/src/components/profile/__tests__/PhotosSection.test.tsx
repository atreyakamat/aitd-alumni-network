import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ok } from './mocks';

const toast = vi.hoisted(() => vi.fn());
const userApi = vi.hoisted(() => ({ uploadProfilePhoto: vi.fn(), uploadCoverPhoto: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
}));

import { PhotosSection } from '@/components/profile/PhotosSection';

const profile = { id: 'me', fullName: 'Ada Alum', batchYear: 2015, department: 'CS', degree: 'B.E.' };
// The input's `accept` filter would silently drop bad files; we want to see our own validation.
const user = () => userEvent.setup({ applyAccept: false });

const fileOfSize = (name: string, type: string, size: number) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

beforeEach(() => {
  toast.mockReset();
  userApi.uploadProfilePhoto.mockReset().mockResolvedValue(ok({ profilePhotoUrl: '/uploads/profiles/new.jpg' }));
  userApi.uploadCoverPhoto.mockReset().mockResolvedValue(ok({ coverPhotoUrl: '/uploads/covers/new.jpg' }));
});

describe('<PhotosSection>', () => {
  it('rejects files over 5 MB', async () => {
    render(<PhotosSection profile={profile} onSaved={vi.fn()} />);
    await user().upload(screen.getByLabelText('Choose profile photo'), fileOfSize('me.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1));

    expect(screen.getByRole('alert')).toHaveTextContent('5 MB or smaller');
    expect(screen.queryByRole('button', { name: 'Upload profile photo' })).not.toBeInTheDocument();
    expect(userApi.uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it('rejects non-image and unsupported image types', async () => {
    render(<PhotosSection profile={profile} onSaved={vi.fn()} />);
    await user().upload(screen.getByLabelText('Choose cover photo'), fileOfSize('cv.pdf', 'application/pdf', 1000));
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or GIF');

    await user().upload(screen.getByLabelText('Choose cover photo'), fileOfSize('me.webp', 'image/webp', 1000));
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or GIF');
    expect(userApi.uploadCoverPhoto).not.toHaveBeenCalled();
  });

  it('uploads a valid profile photo and refreshes', async () => {
    const onSaved = vi.fn();
    render(<PhotosSection profile={profile} onSaved={onSaved} />);
    const file = fileOfSize('me.png', 'image/png', 200 * 1024);
    await user().upload(screen.getByLabelText('Choose profile photo'), file);

    await user().click(screen.getByRole('button', { name: 'Upload profile photo' }));

    await waitFor(() => expect(userApi.uploadProfilePhoto).toHaveBeenCalledWith(file));
    expect(toast).toHaveBeenCalledWith({ title: 'Profile photo updated' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Upload profile photo' })).not.toBeInTheDocument();
  });

  it('uploads a cover photo through the cover endpoint', async () => {
    render(<PhotosSection profile={profile} onSaved={vi.fn()} />);
    const file = fileOfSize('cover.gif', 'image/gif', 1000);
    await user().upload(screen.getByLabelText('Choose cover photo'), file);
    await user().click(screen.getByRole('button', { name: 'Upload cover photo' }));
    await waitFor(() => expect(userApi.uploadCoverPhoto).toHaveBeenCalledWith(file));
    expect(userApi.uploadProfilePhoto).not.toHaveBeenCalled();
  });
});
