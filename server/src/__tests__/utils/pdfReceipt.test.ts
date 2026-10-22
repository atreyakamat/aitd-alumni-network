import {
  generateDonationReceipt,
  generateMembershipReceipt,
  generateReceiptNumber,
  PDFReceiptGenerator,
} from '../../utils/pdfReceipt';

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

describe('generateReceiptNumber', () => {
  it('is deterministic for the same transaction', () => {
    const date = new Date('2026-03-05T10:00:00Z');
    const a = generateReceiptNumber('DON', '1a2b3c4d-5e6f-4000-8000-000000000000', date);
    const b = generateReceiptNumber('DON', '1a2b3c4d-5e6f-4000-8000-000000000000', date);
    expect(a).toBe(b);
    expect(a).toBe('AITD-DON-20260305-1A2B3C4D');
  });

  it('distinguishes type, date and transaction', () => {
    const date = new Date('2026-12-31T23:59:59Z');
    expect(generateReceiptNumber('MEM', 'abcdef12-0000', date)).toBe('AITD-MEM-20261231-ABCDEF12');
    expect(generateReceiptNumber('MEM', 'ffff0000', date)).not.toBe(generateReceiptNumber('MEM', 'abcdef12', date));
  });

  it('matches the documented format and tolerates bad input', () => {
    expect(generateReceiptNumber('DON', 'x', new Date('2026-01-01T00:00:00Z'))).toMatch(
      /^AITD-(DON|MEM)-\d{8}-[A-Z0-9]+$/
    );
    expect(generateReceiptNumber('DON', '', new Date('invalid'))).toBe('AITD-DON-00000000-UNKNOWN');
  });
});

describe('PDF receipts', () => {
  it('renders a donation receipt PDF with optional fields', async () => {
    const buf = await generateDonationReceipt({
      receiptNumber: 'AITD-DON-20260101-ABCDEF12',
      donorName: 'Asha',
      donorEmail: 'asha@aitd.test',
      amount: 2500,
      date: new Date('2026-01-01'),
      paymentId: 'pay_1',
      dedicatedTo: 'Prof. Rao',
      message: 'For the scholarship fund',
      chapterName: 'Pune',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('renders a minimal donation receipt', async () => {
    const buf = await generateDonationReceipt({
      receiptNumber: 'R',
      donorName: 'A',
      donorEmail: 'a@b.c',
      amount: 1,
      date: new Date(),
      paymentId: 'pay_2',
    });
    expect(isPdf(buf)).toBe(true);
  });

  it('renders membership receipts for fixed-term and lifetime tiers', async () => {
    const base = {
      receiptNumber: 'AITD-MEM-20260101-ABCDEF12',
      memberName: 'Ravi',
      memberEmail: 'ravi@aitd.test',
      membershipTier: 'Gold',
      amount: 999,
      startDate: new Date('2026-01-01'),
      paymentId: 'pay_3',
    };
    const fixed = await generateMembershipReceipt({ ...base, endDate: new Date('2027-01-01') });
    const lifetime = await generateMembershipReceipt({ ...base, endDate: null });
    expect(isPdf(fixed)).toBe(true);
    expect(isPdf(lifetime)).toBe(true);
  });

  it('prints "Lifetime" instead of a fake end date for lifetime memberships', async () => {
    const gen = new PDFReceiptGenerator();
    const textSpy = jest.spyOn((gen as any).doc, 'text');
    await gen.generateMembershipReceipt({
      receiptNumber: 'R',
      memberName: 'M',
      memberEmail: 'm@x.y',
      membershipTier: 'Lifetime',
      amount: 5000,
      startDate: new Date('2026-01-01'),
      endDate: null,
      paymentId: 'pay_4',
    });
    const texts = textSpy.mock.calls.map((c) => c[0]);
    expect(texts).toContain('Valid Until:');
    expect(texts).toContain('Lifetime');
  });
});
