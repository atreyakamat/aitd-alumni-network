import { transactionService } from '../../services/transactionService';
import { prismaMock } from '../../../tests/helpers';

describe('transactionService.getMyTransactions', () => {
  it("returns only the caller's transactions, newest first, paginated", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([{ id: 't1', status: 'SUCCESS' }]);
    prismaMock.transaction.count.mockResolvedValue(1);

    const result = await transactionService.getMyTransactions('u1', { page: 1, limit: 10 });

    const args = prismaMock.transaction.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.select.gatewaySignature).toBeUndefined();
    expect(result.data[0]).toMatchObject({ id: 't1', receiptAvailable: true });
    expect(result.pagination.total).toBe(1);
  });

  it('filters by type and status when valid', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    prismaMock.transaction.count.mockResolvedValue(0);
    await transactionService.getMyTransactions('u1', { type: 'DONATION', status: 'FAILED' });
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', type: 'DONATION', status: 'FAILED' });
  });

  it('ignores invalid filters', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    prismaMock.transaction.count.mockResolvedValue(0);
    await transactionService.getMyTransactions('u1', { type: 'BITCOIN', status: 'WHATEVER' });
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('marks receipts unavailable for non-successful payments', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([{ id: 't2', status: 'PENDING' }]);
    prismaMock.transaction.count.mockResolvedValue(1);
    const result = await transactionService.getMyTransactions('u1', {});
    expect(result.data[0].receiptAvailable).toBe(false);
  });
});
