import { Request, Response, NextFunction } from 'express';
import { membershipService } from '../services/membershipService';
import { donationService } from '../services/donationService';

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

export const membershipController = new MembershipController();
export const donationController = new DonationController();
