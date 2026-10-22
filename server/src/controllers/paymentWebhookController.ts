import { Request, Response, NextFunction } from 'express';
import config from '../config';
import { AppError } from '../middleware/errorHandler';
import { RawBodyRequest } from '../middleware/rawBody';
import { paymentWebhookService, RazorpayWebhookEvent } from '../services/paymentWebhookService';
import { verifyWebhookSignature } from '../utils/razorpay';

export const paymentWebhookController = {
  /**
   * POST /api/payments/webhook/razorpay (public; authenticated by HMAC signature).
   *
   * 503 while RAZORPAY_WEBHOOK_SECRET is unset (unsigned events are never accepted),
   * 400 for a missing/invalid signature, otherwise 200 `{ success: true }` for every
   * verified event, including ones that are ignored, so Razorpay stops retrying.
   * Unexpected errors surface as 500 so Razorpay redelivers (processing is idempotent).
   */
  async razorpay(req: Request, res: Response, next: NextFunction) {
    try {
      const secret = config.razorpay.webhookSecret;
      if (!secret) {
        throw new AppError('Razorpay webhooks are not configured', 503, 'WEBHOOK_NOT_CONFIGURED');
      }

      // Verify against the exact bytes received; req.body has been parsed and sanitised.
      const rawBody = (req as RawBodyRequest).rawBody;
      const signature = req.get('x-razorpay-signature') || '';
      if (!Buffer.isBuffer(rawBody) || !verifyWebhookSignature(rawBody, signature, secret)) {
        throw new AppError('Invalid webhook signature', 400, 'INVALID_SIGNATURE');
      }

      let event: unknown;
      try {
        event = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new AppError('Malformed webhook payload', 400, 'INVALID_PAYLOAD');
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AppError('Malformed webhook payload', 400, 'INVALID_PAYLOAD');
      }

      await paymentWebhookService.handleEvent(event as RazorpayWebhookEvent, {
        eventId: req.get('x-razorpay-event-id') || undefined,
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
};
