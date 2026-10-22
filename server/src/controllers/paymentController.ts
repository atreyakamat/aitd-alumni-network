import { Request, Response, NextFunction } from 'express';
import { membershipService } from '../services/membershipService';
import { donationService, guestDonorFromMetadata } from '../services/donationService';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { isOwnerOrAdmin } from '../config/permissions';
import { generateDonationReceipt, generateMembershipReceipt, generateReceiptNumber } from '../utils/pdfReceipt';
import { logAuditAction } from '../services/auditService';

const toInt = (value: unknown, fallback: number) => {
  const parsed = parseInt(value as string, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Membership Controller
export class MembershipController {
  async getTiers(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membershipService.getTiers();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getTier(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await membershipService.getTier(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createTier(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membershipService.createTier(req.body);
      await logAuditAction({
        userId: req.user?.id,
        action: 'CREATE',
        entityType: 'MEMBERSHIP',
        entityId: result.id,
        newValues: req.body,
        ipAddress: req.ip,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateTier(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await membershipService.updateTier(id, req.body);
      await logAuditAction({
        userId: req.user?.id,
        action: 'UPDATE',
        entityType: 'MEMBERSHIP',
        entityId: id,
        newValues: req.body,
        ipAddress: req.ip,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyMembership(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membershipService.getUserMembership(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMembershipHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membershipService.getMembershipHistory(
        req.user!.id,
        toInt(req.query.page, 1),
        toInt(req.query.limit, 20)
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { tierId } = req.body || {};
      const result = await membershipService.createOrder(req.user!.id, tierId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      const result = await membershipService.verifyPayment(
        req.user!.id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getPaidMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await membershipService.getPaidMembers(toInt(req.query.page, 1), toInt(req.query.limit, 20));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}

// Donation Controller
export class DonationController {
  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.createOrder(req.user?.id || null, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
      // Every donation detail was stored server-side at order time; only the Razorpay fields are read here.
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      const result = await donationService.verifyPayment(
        req.user?.id || null,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getDonorsWall(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getDonorsWall(toInt(req.query.page, 1), toInt(req.query.limit, 20));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getFeaturedDonors(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getFeaturedDonors();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getChapterDonations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getChapterDonations();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyDonations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getUserDonations(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getDonationStats();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getLeaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await donationService.getDonationLeaderboard(toInt(req.query.limit, 10));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// Transaction Controller
export class TransactionController {
  async getReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const userRole = req.user!.userRole;

      const transaction = await prisma.transaction.findUnique({
        where: { id },
        include: {
          user: true,
          donations: {
            include: { chapter: true },
          },
          memberships: {
            include: { tier: true },
          },
        },
      });

      if (!transaction) {
        throw new AppError('Transaction not found', 404, 'NOT_FOUND');
      }

      // Check ownership (admins can access any receipt)
      if (!isOwnerOrAdmin({ id: userId, userRole }, transaction.userId)) {
        throw new AppError('Unauthorized access to receipt', 403, 'FORBIDDEN');
      }

      if (transaction.status !== 'SUCCESS') {
        throw new AppError('Receipt only available for successful transactions', 400, 'BAD_REQUEST');
      }

      // Guest donations (and records of a deleted user) have no user: use the donor details on the order.
      // Ownerless receipts are admin-only here; guests receive theirs by e-mail.
      const party = transaction.user
        ? { name: transaction.user.fullName, email: transaction.user.email }
        : transaction.type === 'DONATION'
          ? guestDonorFromMetadata(transaction.metadata)
          : { name: 'Deleted User', email: '' };

      let pdfBuffer: Buffer;

      if (transaction.type === 'DONATION') {
        const donation = transaction.donations[0];
        if (!donation) {
          throw new AppError('Donation details not found', 404, 'NOT_FOUND');
        }

        pdfBuffer = await generateDonationReceipt({
          receiptNumber: generateReceiptNumber('DON', transaction.id, transaction.createdAt),
          donorName: party.name,
          donorEmail: party.email,
          amount: Number(transaction.amount),
          date: transaction.createdAt,
          paymentId: transaction.gatewayPaymentId || transaction.id,
          dedicatedTo: donation.dedicatedTo || undefined,
          message: donation.message || undefined,
          chapterName: donation.chapter?.name,
        });
      } else if (transaction.type === 'MEMBERSHIP') {
        const membership = transaction.memberships[0];
        if (!membership) {
          throw new AppError('Membership details not found', 404, 'NOT_FOUND');
        }

        pdfBuffer = await generateMembershipReceipt({
          receiptNumber: generateReceiptNumber('MEM', transaction.id, transaction.createdAt),
          memberName: party.name,
          memberEmail: party.email,
          membershipTier: membership.tier.name,
          amount: Number(transaction.amount),
          startDate: membership.startDate,
          endDate: membership.endDate, // null → printed as "Lifetime"
          paymentId: transaction.gatewayPaymentId || transaction.id,
        });
      } else {
        throw new AppError('Invalid transaction type for receipt', 400, 'BAD_REQUEST');
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receipt_${transaction.id}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
}

export const membershipController = new MembershipController();
export const donationController = new DonationController();
export const transactionController = new TransactionController();
