import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { clientLinks } from '../utils/clientLinks';
import { notificationService } from './notificationService';
import { ReferralStatus, Prisma } from '@prisma/client';

const MAX_PENDING_PER_REQUESTER = 10; // anti-spam cap
const personSelect = { id: true, fullName: true, profilePhotoUrl: true, currentDesignation: true, batchYear: true } as const;

export class ReferralService {
  /** Alumni whose current/past work experience is at `company` — candidates to ask for a referral. */
  async findReferrers(company: string, viewerId: string, limit = 20) {
    const name = typeof company === 'string' ? company.trim() : '';
    if (name.length < 2) throw new AppError('A company name is required', 400, 'VALIDATION_ERROR');

    const rows = await prisma.workExperience.findMany({
      where: {
        company: { equals: name, mode: 'insensitive' },
        userId: { not: viewerId },
        user: { isActive: true },
      },
      select: { role: true, isCurrent: true, user: { select: personSelect } },
      orderBy: { isCurrent: 'desc' },
      take: 100,
    });

    // De-duplicate by user (a person may have multiple roles at the company).
    const seen = new Set<string>();
    const people: Array<{ role: string; isCurrent: boolean; user: typeof rows[number]['user'] }> = [];
    for (const r of rows) {
      if (seen.has(r.user.id)) continue;
      seen.add(r.user.id);
      people.push(r);
      if (people.length >= limit) break;
    }
    return people;
  }

  async createRequest(requesterId: string, data: { targetId: string; company: string; message: string; jobId?: string | null }) {
    const targetId = String(data?.targetId || '');
    const company = typeof data?.company === 'string' ? data.company.trim() : '';
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    if (!targetId) throw new AppError('A target member is required', 400, 'VALIDATION_ERROR');
    if (targetId === requesterId) throw new AppError('You cannot request a referral from yourself', 400, 'INVALID_REQUEST');
    if (!company) throw new AppError('A company is required', 400, 'VALIDATION_ERROR');
    if (!message) throw new AppError('A message is required', 400, 'VALIDATION_ERROR');

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } });
    if (!target || !target.isActive) throw new AppError('Member not found', 404, 'NOT_FOUND');

    const pending = await prisma.referralRequest.count({ where: { requesterId, status: 'PENDING' } });
    if (pending >= MAX_PENDING_PER_REQUESTER) {
      throw new AppError(`You can have at most ${MAX_PENDING_PER_REQUESTER} pending referral requests`, 429, 'TOO_MANY_REQUESTS');
    }

    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { fullName: true } });
    let request;
    try {
      request = await prisma.referralRequest.create({
        data: { requesterId, targetId, company, message: message.slice(0, 2000), jobId: data.jobId || null },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError('You have already asked this member for a referral for this role', 409, 'ALREADY_REQUESTED');
      }
      throw err;
    }

    await notificationService.createNotification({
      userId: targetId,
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Referral request',
      message: `${requester?.fullName ?? 'A member'} asked you for a referral at ${company}.`,
      link: clientLinks.referrals(),
      metadata: { referralId: request.id },
    });
    return request;
  }

  /** Requests where the caller is the target (received) or the requester (sent). */
  async listMine(userId: string, box: 'received' | 'sent', filters: { page?: number; limit?: number } = {}) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);
    const where: Prisma.ReferralRequestWhereInput = box === 'sent' ? { requesterId: userId } : { targetId: userId };
    const [items, total] = await Promise.all([
      prisma.referralRequest.findMany({
        where,
        include: {
          requester: { select: personSelect },
          target: { select: personSelect },
          job: { select: { id: true, title: true, company: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.referralRequest.count({ where }),
    ]);
    return buildPaginationResponse(items, total, page, limit);
  }

  /** The target accepts or declines. Accepting notifies the requester to continue in messages. */
  async respond(userId: string, requestId: string, accept: boolean) {
    const request = await prisma.referralRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError('Referral request not found', 404, 'NOT_FOUND');
    if (request.targetId !== userId) throw new AppError('Not authorized to respond to this request', 403, 'FORBIDDEN');
    if (request.status !== 'PENDING') throw new AppError('This request has already been answered', 400, 'ALREADY_PROCESSED');

    const status: ReferralStatus = accept ? 'ACCEPTED' : 'DECLINED';
    const updated = await prisma.referralRequest.update({ where: { id: requestId }, data: { status } });

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    await notificationService.createNotification({
      userId: request.requesterId,
      type: 'ADMIN_ANNOUNCEMENT',
      title: accept ? 'Referral request accepted' : 'Referral request declined',
      message: accept
        ? `${target?.fullName ?? 'The member'} accepted your referral request for ${request.company}. Message them to continue.`
        : `${target?.fullName ?? 'The member'} could not take up your referral request for ${request.company}.`,
      link: accept ? clientLinks.conversation(userId) : clientLinks.referrals(),
      metadata: { referralId: requestId },
    });
    return updated;
  }
}

export const referralService = new ReferralService();
