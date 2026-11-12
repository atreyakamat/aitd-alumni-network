/**
 * File upload content-validation (server/src/utils/storage.ts).
 *
 * storage.ts validates VIDEO uploads by sniffing real magic bytes
 * (sniffVideoFormat) and rejects anything that doesn't match, regardless of
 * the declared extension/mimetype. IMAGE uploads get no such check: multer's
 * fileFilter only compares the claimed `originalname` extension against the
 * attacker-supplied `Content-Type` of that multipart field (both fully
 * attacker-controlled), and `optimizeImageBuffer` only re-encodes
 * jpeg/png/webp through sharp — GIF is passed straight to disk untouched
 * because it is absent from COMPRESSIBLE_IMAGE_TYPES. So a ".gif" upload
 * whose body is not a GIF at all (e.g. an HTML/SVG polyglot) is accepted and
 * stored byte-for-byte.
 *
 * Mitigating control confirmed separately: helmet sets
 * `X-Content-Type-Options: nosniff` globally (including on the /uploads
 * static route), and express.static derives Content-Type from the stored
 * extension, so the mis-typed content is at least served with a non-HTML
 * Content-Type and browsers are told not to sniff it. That materially
 * reduces — but does not eliminate — impact (e.g. SVG-in-a-.gif served as
 * image/gif cannot execute as a document in a normal navigation/img context).
 */
import { http, createUser, prisma } from '../../integration/helpers';

describe('upload content validation: image MIME/extension vs real content', () => {
  it('[VULNERABLE] accepts a ".gif" upload whose body is actually an HTML/script polyglot', async () => {
    const user = await createUser('MEMBER');
    const htmlPolyglot = Buffer.from(
      'GIF89a<script>alert(document.domain)</script>' // starts with the GIF magic string but is not a real GIF
    );

    const res = await http()
      .patch('/api/users/profile-photo')
      .set('Authorization', user.auth)
      .attach('photo', htmlPolyglot, { filename: 'evil.gif', contentType: 'image/gif' });

    // SECURE expectation: the server should sniff real image content (the
    // way it already does for video uploads) and reject a payload that is
    // not an actual, decodable GIF.
    expect(res.status).toBe(400);
  });

  it('control: the stored (mis-typed) file is served with X-Content-Type-Options: nosniff', async () => {
    const user = await createUser('MEMBER');
    const htmlPolyglot = Buffer.from('GIF89a<script>alert(1)</script>');

    const uploadRes = await http()
      .patch('/api/users/profile-photo')
      .set('Authorization', user.auth)
      .attach('photo', htmlPolyglot, { filename: 'evil.gif', contentType: 'image/gif' });

    if (uploadRes.status !== 200) {
      // Already rejected — nothing to fetch, and the vulnerability above is not present.
      return;
    }

    const url: string = uploadRes.body.data.profilePhotoUrl;
    const fetchRes = await http().get(url);
    expect(fetchRes.headers['x-content-type-options']).toBe('nosniff');
    expect(fetchRes.headers['content-type']).not.toMatch(/html/i);
  });

  it('rejects a video route disguised with a fake extension (control: video magic-byte sniffing works)', async () => {
    const user = await createUser('MEMBER');
    const notAVideo = Buffer.from('this is not an mp4/webm/mov file, just text pretending to be one');

    const res = await http()
      .post('/api/posts/video')
      .set('Authorization', user.auth)
      .attach('video', notAVideo, { filename: 'clip.mp4', contentType: 'video/mp4' });

    // storeVideo() sniffs real container magic bytes and must reject this,
    // regardless of the route existing / other validation order.
    expect([400, 404]).toContain(res.status);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
