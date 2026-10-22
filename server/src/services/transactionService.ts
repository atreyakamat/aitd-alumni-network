import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import prisma from '../config/database';
import { buildPaginationResponse, paginationHelper } from '../utils/helpers';

const TYPES: TransactionType[] = ['MEMBERSHIP', 'DONATION'];
const STATUSES: TransactionStatus[] = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'];

export interface TransactionFilters {
  type?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export class TransactionService {
  async getMyTransactions(userId: string, filters: TransactionFilters) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const { skip, take } = paginationHelper(page, limit);

    const where: Prisma.TransactionWhereInput = { userId };
    if (filters.type && TYPES.includes(filters.type as TransactionType)) where.type = filters.type as TransactionType;
    if (filters.status && STATUSES.includes(filters.status as TransactionStatus)) {
      where.status = filters.status as TransactionStatus;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          status: true,
          gatewayPaymentId: true,
          createdAt: true,
          memberships: { select: { tier: { select: { name: true } } } },
          donations: { select: { chapter: { select: { name: true } }, dedicatedTo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.transaction.count({ where }),
    ]);

    return buildPaginationResponse(
      transactions.map((t) => ({ ...t, receiptAvailable: t.status === 'SUCCESS' })),
      total,
      page,
      limit
    );
  }
}

export const transactionService = new TransactionService();
