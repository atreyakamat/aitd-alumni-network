import { assertUploadRef, optionalUploadRef, uploadFolderOf } from '../../utils/uploadRefs';
import { config } from '../../config';

const S3 = (folderAndFile: string) => `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${folderAndFile}`;

describe('uploadFolderOf', () => {
  it('reads the folder of a locally stored file', () => {
    expect(uploadFolderOf('/uploads/college-videos/a.mp4')).toBe('college-videos');
  });

  it('reads the folder of a file in the configured bucket', () => {
    expect(uploadFolderOf(S3('magazine-covers/c.jpg'))).toBe('magazine-covers');
  });

  it.each([
    ['an external URL', 'https://evil.example/uploads/college-videos/a.mp4'],
    ['another bucket', 'https://other-bucket.s3.ap-south-1.amazonaws.com/college-videos/a.mp4'],
    ['a path outside uploads', '/etc/passwd'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a file directly in uploads (no folder)', '/uploads/a.mp4'],
    ['a nested folder', '/uploads/college-videos/deeper/a.mp4'],
    ['a traversal that lands in another folder', '/uploads/college-videos/../profile-photos/a.jpg'],
    ['an encoded traversal', '/uploads/college-videos/%2e%2e/profile-photos/a.jpg'],
    ['a non-string', 42],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(uploadFolderOf(value)).toBeNull();
  });
});

describe('assertUploadRef', () => {
  it('returns the reference when it is a file from the allowed folder', () => {
    expect(assertUploadRef('/uploads/college-videos/a.mp4', 'videoUrl', ['college-videos'])).toBe('/uploads/college-videos/a.mp4');
    expect(assertUploadRef(S3('college-videos/a.mp4'), 'videoUrl', ['college-videos'])).toBe(S3('college-videos/a.mp4'));
  });

  it('trims surrounding spaces', () => {
    expect(assertUploadRef('  /uploads/magazines/m.pdf ', 'fileUrl', ['magazines'])).toBe('/uploads/magazines/m.pdf');
  });

  it('refuses a file that belongs to another feature: pointing at someone else\'s photo must not be possible', () => {
    for (const other of ['/uploads/profile-photos/victim.jpg', '/uploads/posts/victim.png', '/uploads/receipts/r.pdf', S3('posts/victim.png')]) {
      expect(() => assertUploadRef(other, 'videoUrl', ['college-videos'])).toThrow(
        expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' })
      );
    }
  });

  it('refuses external links, traversal and non-strings', () => {
    for (const bad of ['https://youtube.com/watch?v=1', '/uploads/college-videos/../posts/x.png', 'javascript:alert(1)', null, undefined, {}, 7]) {
      expect(() => assertUploadRef(bad, 'videoUrl', ['college-videos'])).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('names the field in the message', () => {
    expect(() => assertUploadRef('/x', 'thumbnailUrl', ['video-thumbnails'])).toThrow(/thumbnailUrl/);
  });
});

describe('optionalUploadRef', () => {
  it('treats absent, null and empty as "not given"', () => {
    expect(optionalUploadRef(undefined, 'thumbnailUrl', ['video-thumbnails'])).toBeUndefined();
    expect(optionalUploadRef(null, 'thumbnailUrl', ['video-thumbnails'])).toBeNull();
    expect(optionalUploadRef('', 'thumbnailUrl', ['video-thumbnails'])).toBeNull();
    expect(optionalUploadRef('   ', 'thumbnailUrl', ['video-thumbnails'])).toBeNull();
  });

  it('validates a value that is given', () => {
    expect(optionalUploadRef('/uploads/video-thumbnails/t.jpg', 'thumbnailUrl', ['video-thumbnails'])).toBe('/uploads/video-thumbnails/t.jpg');
    expect(() => optionalUploadRef('/uploads/posts/t.jpg', 'thumbnailUrl', ['video-thumbnails'])).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
