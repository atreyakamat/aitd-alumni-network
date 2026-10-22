import fs from 'fs';
import path from 'path';
import { clientLinks } from '../../utils/clientLinks';

const CLIENT_APP = path.resolve(__dirname, '../../../../client/src/app');
const SERVICES = path.resolve(__dirname, '../../services');

/** URL patterns of every page in the Next.js app router (route groups stripped). */
const clientRoutes = (): RegExp[] => {
  const routes: RegExp[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const isGroup = /^\(.*\)$/.test(entry.name);
        walk(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]);
      } else if (entry.name === 'page.tsx') {
        const pattern = segments.map((s) => (/^\[.+\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        routes.push(new RegExp(`^/${pattern.join('/')}$`));
      }
    }
  };
  walk(CLIENT_APP, []);
  return routes;
};

const pathOf = (link: string) => link.split(/[?#]/)[0];

describe('clientLinks', () => {
  const routes = clientRoutes();

  it.each([
    ['feed', clientLinks.feed()],
    ['mentorship', clientLinks.mentorship()],
    ['network', clientLinks.network()],
    ['conversation', clientLinks.conversation('user-1')],
    ['profile', clientLinks.profile('user-1')],
    ['post', clientLinks.post('post-1')],
    ['post comment', clientLinks.post('post-1', 'comment-1')],
    ['hashtag', clientLinks.hashtag('placements')],
    ['reels', clientLinks.reels()],
    ['saved', clientLinks.saved()],
    ['adminReports', clientLinks.adminReports()],
    ['event', clientLinks.event('event-1')],
    ['job', clientLinks.job('job-1')],
    ['adminDashboard', clientLinks.adminDashboard()],
    ['adminAudit', clientLinks.adminAudit()],
    ['adminAudit (filtered)', clientLinks.adminAudit('PAYMENT_MISMATCH')],
  ])('%s link resolves to an existing client page', (_name, link) => {
    expect(link.startsWith('/')).toBe(true);
    expect(routes.some((r) => r.test(pathOf(link)))).toBe(true);
  });

  it('opens the conversation with the given user', () => {
    expect(clientLinks.conversation('a b')).toBe('/messages?u=a%20b');
  });

  it('opens the audit log, optionally pre-filtered by action', () => {
    expect(clientLinks.adminAudit()).toBe('/admin/audit');
    expect(clientLinks.adminAudit('PAYMENT_MISMATCH')).toBe('/admin/audit?action=PAYMENT_MISMATCH');
    expect(clientLinks.adminAudit('a&b=c')).toBe('/admin/audit?action=a%26b%3Dc');
  });

  it('encodes ids so they cannot break out of the path', () => {
    expect(clientLinks.profile('../admin')).toBe('/profile/..%2Fadmin');
  });

  it('services never hard-code notification links', () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(SERVICES).filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(SERVICES, file), 'utf8');
      source.split('\n').forEach((line, i) => {
        if (/\blink:\s*[`'"]\//.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
