import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

describe('uploads static handler', () => {
  let tmp: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-uploads-'));
    fs.mkdirSync(path.join(tmp, 'uploads', 'receipts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'uploads', 'posts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'uploads', 'receipts', 'receipt_1.pdf'), '%PDF donor name and amount');
    fs.writeFileSync(path.join(tmp, 'uploads', 'posts', 'photo.jpg'), 'jpg');
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const app = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../../app');
    return createApp({ disableRateLimit: true });
  };

  it('still serves ordinary public uploads', async () => {
    const res = await request(app()).get('/uploads/posts/photo.jpg');
    expect(res.status).toBe(200);
  });

  it.each([
    '/uploads/receipts/receipt_1.pdf',
    '/uploads/receipts/',
    '/uploads/Receipts/receipt_1.pdf',
    '/uploads/%72eceipts/receipt_1.pdf',
    '/uploads//receipts/receipt_1.pdf',
    '/uploads/./receipts/receipt_1.pdf',
  ])('never serves receipts publicly (%s): they only exist behind the authenticated receipt endpoint', async (url) => {
    const res = await request(app()).get(url);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('donor name');
  });
});
