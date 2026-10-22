import fs from 'fs';
import path from 'path';
import router from '../../src/routes';
import { collectRoutes, renderApiReference } from './apiReference';

const DOC = path.resolve(__dirname, '../../../docs/API_REFERENCE.md');

describe('docs/API_REFERENCE.md', () => {
  const routes = collectRoutes(router);

  it('is up to date with the router (run `npm run docs:api` in server/)', () => {
    const current = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n') : '';
    expect(current).toBe(`${renderApiReference(routes)}\n`);
  });

  it('derives access levels from the guard middleware', () => {
    const find = (method: string, p: string) => routes.find((r) => r.method === method && r.path === p);
    expect(find('post', '/auth/login')).toMatchObject({ access: 'public', validated: true });
    expect(find('get', '/auth/me')).toMatchObject({ access: 'auth' });
    expect(find('get', '/news')).toMatchObject({ access: 'optional' });
    expect(find('get', '/admin/users')).toMatchObject({ access: 'admin' });
    expect(find('delete', '/chapters/:id')).toMatchObject({ access: 'superAdmin' });
    expect(find('patch', '/chapters/:id')).toMatchObject({ access: 'chapterAdmin' });
  });
});
