import { Request, Response, NextFunction } from 'express';
import { membershipService } from '../services/membershipService';
import { donationService } from '../services/donationService';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { generateDonationReceipt, generateMembershipReceipt, generateReceiptNumber } from '../utils/pdfReceipt';

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
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateTier(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await membershipService.updateTier(id, req.body);
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
      const result = await membershipService.getMembershipHistory(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { tierId } = req.body;
      const result = await membershipService.createOrder(req.user!.id, tierId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
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
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await membershipService.getPaidMembers(page, limit);
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
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, ...donationData } = req.body;
      const result = await donationService.verifyPayment(
        req.user?.id || null,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        donationData
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getDonorsWall(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await donationService.getDonorsWall(page, limit);
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
      if (transaction.userId !== userId && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
        throw new AppError('Unauthorized access to receipt', 403, 'FORBIDDEN');
      }

      if (transaction.status !== 'SUCCESS') {
        throw new AppError('Receipt only available for successful transactions', 400, 'BAD_REQUEST');
      }

      let pdfBuffer: Buffer;

      if (transaction.type === 'DONATION') {
        const donation = transaction.donations[0];
        if (!donation) {
          throw new AppError('Donation details not found', 404, 'NOT_FOUND');
        }

        pdfBuffer = await generateDonationReceipt({
          receiptNumber: generateReceiptNumber('DON'),
          donorName: transaction.user.fullName,
          donorEmail: transaction.user.email,
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
          receiptNumber: generateReceiptNumber('MEM'),
          memberName: transaction.user.fullName,
          memberEmail: transaction.user.email,
          membershipTier: membership.tier.name,
          amount: Number(transaction.amount),
          startDate: membership.startDate,
          endDate: membership.endDate || new Date(), // Fallback for lifetime
          paymentId: transaction.gatewayPaymentId || transaction.id,
        });
      } else {
        throw new AppError('Invalid transaction type for receipt', 400, 'BAD_REQUEST');
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receipt_${id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
}

export const membershipController = new MembershipController();
export const donationController = new DonationController();
export const transactionController = new TransactionController();
