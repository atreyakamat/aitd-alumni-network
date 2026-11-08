/**
 * End-to-end proof that a tab-smuggled `javascript:` URI survives sanitizeInput
 * + zod's `.url()` validator and gets stored verbatim on fields the client
 * later renders as a raw `<a href>` with no scheme check (post.linkUrl,
 * job.applicationLink). Run against the same embedded-Postgres harness as
 * tests/integration via supertest + createApp.
 *
 * Root cause chain:
 *  1. middleware/sanitizeInput.ts DANGEROUS_PROTOCOL only matches a literal,
 *     contiguous "javascript"/"vbscript" — a single tab/newline inside the
 *     word defeats it (see sanitizer-bypass.sec.test.ts).
 *  2. zod's `z.string().url()` validates via the WHATWG `URL` constructor,
 *     which itself STRIPS ASCII tab/newline/CR before parsing — so the very
 *     spec compliance meant to make this "a valid URL" check lets the
 *     smuggled payload through as a normalized `javascript:` URL.
 *  3. jobService/postService store the field with no additional scheme
 *     allowlist (unlike marketplaceService.assertWebsite, which DOES
 *     restrict to http(s) — see the control test below).
 *  4. The client renders `href={job.applicationLink}` / `href={post.linkUrl}`
 *     directly (client/src/components/social/PostCard.tsx:105,
 *     client/src/app/(main)/jobs/[id]/page.tsx:135) with no scheme check and
 *     no CSP on the page (client ships no Content-Security-Policy header at
 *     all — see platform.sec.test.ts), so a click executes the script in the
 *     viewer's authenticated session.
 */
import { http, createUser, prisma } from '../../integration/helpers';

const TAB_SMUGGLED_JS = 'java\tscript:alert(document.cookie)';

describe('stored XSS via URL-scheme fields (javascript: smuggling)', () => {
  it('[VULNERABLE] job.applicationLink stores a tab-smuggled javascript: URI unmodified', async () => {
    const poster = await createUser('MEMBER');

    const createRes = await http()
      .post('/api/jobs')
      .set('Authorization', poster.auth)
      .send({
        title: 'Security Test Role',
        description: 'd'.repeat(20),
        company: 'ACME',
        applicationLink: TAB_SMUGGLED_JS,
      });

    // Expected SECURE behaviour: either 400 (rejected), or the stored value
    // no longer parses as a javascript: URL once control characters are
    // normalized the way a browser/WHATWG URL parser would.
    if (createRes.status === 201) {
      const jobId = createRes.body.data.id;
      const getRes = await http().get(`/api/jobs/${jobId}`).set('Authorization', poster.auth);
      const stored = getRes.body.data.applicationLink as string;
      let normalizedProtocol = '';
      try {
        normalizedProtocol = new URL(stored).protocol;
      } catch {
        /* not a URL at all -> fine */
      }
      expect(normalizedProtocol).not.toBe('javascript:');
    } else {
      expect(createRes.status).toBe(400);
    }
  });

  it('[VULNERABLE] post.linkUrl stores a tab-smuggled javascript: URI unmodified', async () => {
    const author = await createUser('MEMBER');

    const createRes = await http()
      .post('/api/posts')
      .set('Authorization', author.auth)
      .send({
        content: 'Check out this link',
        linkUrl: TAB_SMUGGLED_JS,
      });

    if (createRes.status === 201) {
      const stored = createRes.body.data.linkUrl as string;
      let normalizedProtocol = '';
      try {
        normalizedProtocol = new URL(stored).protocol;
      } catch {
        /* not a URL at all -> fine */
      }
      expect(normalizedProtocol).not.toBe('javascript:');
    } else {
      expect(createRes.status).toBe(400);
    }
  });

  it('control: marketplace listing website IS correctly restricted to http(s) and rejects javascript:', async () => {
    const seller = await createUser('MEMBER');
    const res = await http()
      .post('/api/marketplace')
      .set('Authorization', seller.auth)
      .send({
        type: 'BUSINESS',
        title: 'Handmade goods',
        category: 'Crafts',
        description: 'd'.repeat(20),
        website: TAB_SMUGGLED_JS,
      });
    // listingWebsite (zod regex) AND assertWebsite() in marketplaceService both
    // enforce /^https?:\/\//, so this must be rejected at the validation layer.
    expect(res.status).toBe(400);
  });

  it('control: a plain (non-smuggled) javascript: URI is rejected/stripped by linkUrl', async () => {
    const author = await createUser('MEMBER');
    const res = await http()
      .post('/api/posts')
      .set('Authorization', author.auth)
      .send({ content: 'plain', linkUrl: 'javascript:alert(1)' });
    if (res.status === 201) {
      expect(res.body.data.linkUrl ?? '').not.toMatch(/^javascript:/i);
    } else {
      expect(res.status).toBe(400);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
