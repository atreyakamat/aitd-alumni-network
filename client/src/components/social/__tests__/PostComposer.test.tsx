import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ME, makePost } from './fixtures';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const socialApi = vi.hoisted(() => ({
  createPost: vi.fn(),
  uploadImages: vi.fn(),
  uploadVideo: vi.fn(),
  mentionSearch: vi.fn(),
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { PostComposer } from '@/components/social/PostComposer';

beforeEach(() => {
  authState.user = { ...ME };
  toast.mockReset();
  Object.values(socialApi).forEach((fn) => fn.mockReset());
  socialApi.mentionSearch.mockResolvedValue([{ id: 'u1', fullName: 'Asha Rao', profilePhotoUrl: null, currentDesignation: 'Engineer', batchYear: 2015 }]);
  if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:preview';
  if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => undefined;
});

describe('PostComposer', () => {
  it('posts text with a picked @mention and shows the hashtags it found', async () => {
    const created = makePost({ id: 'new', content: 'Hi @Asha Rao #Reunion' });
    socialApi.createPost.mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<PostComposer onCreated={onCreated} />);

    const box = screen.getByRole('combobox', { name: 'Write a post' });
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await userEvent.type(box, 'Hi @as');
    const option = await screen.findByRole('option', { name: /Asha Rao/ }, { timeout: 2000 });
    await userEvent.click(option);
    expect(box).toHaveValue('Hi @Asha Rao ');
    await userEvent.type(box, '#Reunion');
    expect(screen.getByRole('list', { name: 'Hashtags in this post' })).toHaveTextContent('#reunion');

    await userEvent.selectOptions(screen.getByLabelText('Who can see this'), 'CONNECTIONS');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() =>
      expect(socialApi.createPost).toHaveBeenCalledWith({
        content: 'Hi @Asha Rao #Reunion',
        mediaUrls: [],
        visibility: 'CONNECTIONS',
        mentionIds: ['u1'],
      })
    );
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(box).toHaveValue('');
  });

  it('uploads images, previews them and attaches the returned URLs', async () => {
    socialApi.uploadImages.mockResolvedValue(['/uploads/posts/a.jpg']);
    socialApi.createPost.mockResolvedValue(makePost());
    render(<PostComposer />);
    const file = new File(['img'], 'a.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByTestId('composer-image-input'), file);
    expect(await screen.findByRole('img', { name: 'Attachment 1' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(socialApi.createPost).toHaveBeenCalledWith(expect.objectContaining({ mediaUrls: ['/uploads/posts/a.jpg'], content: '' })));
  });

  it('rejects unsupported video files before uploading', async () => {
    render(<PostComposer />);
    const file = new File(['vid'], 'a.avi', { type: 'video/x-msvideo' });
    await userEvent.upload(screen.getByTestId('composer-video-input'), file, { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('MP4, WebM or MOV');
    expect(socialApi.uploadVideo).not.toHaveBeenCalled();
  });

  it('in reel mode, needs a video before it can post and sends isReel', async () => {
    socialApi.uploadVideo.mockImplementation(async (_f: File, onProgress: (n: number) => void) => {
      onProgress(50);
      return { url: '/uploads/videos/r.mp4', mimeType: 'video/mp4', size: 3 };
    });
    socialApi.createPost.mockResolvedValue(makePost({ isReel: true, videoUrl: '/uploads/videos/r.mp4' }));
    render(<PostComposer mode="reel" />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Reel caption' }), 'Campus tour');
    expect(screen.getByRole('button', { name: 'Share reel' })).toBeDisabled();
    await userEvent.upload(screen.getByTestId('composer-video-input'), new File(['v'], 'r.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share reel' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Share reel' }));
    await waitFor(() =>
      expect(socialApi.createPost).toHaveBeenCalledWith(expect.objectContaining({ content: 'Campus tour', videoUrl: '/uploads/videos/r.mp4', isReel: true }))
    );
  });

  it('shows the server error and keeps the draft', async () => {
    socialApi.createPost.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: { error: { message: 'Too long' } } } }));
    render(<PostComposer />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Write a post' }), 'Draft text');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too long');
    expect(screen.getByRole('combobox', { name: 'Write a post' })).toHaveValue('Draft text');
  });
});
