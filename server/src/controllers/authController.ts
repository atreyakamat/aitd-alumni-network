import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { twoFactorService } from '../services/twoFactorService';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body);
      
      // Check if 2FA is enabled for this user
      if (result.user && result.user.twoFactorEnabled) {
        // Send OTP and return pending state
        await twoFactorService.sendOTP(result.user.id, result.user.email);
        
        return res.json({
          success: true,
          data: {
            requires2FA: true,
            userId: result.user.id,
            message: 'Verification code sent to your email',
          },
        });
      }
      
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Verify 2FA OTP and complete login
  async verify2FA(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, otp } = req.body;

      if (!userId || !otp) {
        return res.status(400).json({
          success: false,
          error: 'User ID and OTP are required',
        });
      }

      const isValid = await twoFactorService.verifyOTP(userId, otp);

      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired verification code',
        });
      }

      // Complete login by generating tokens
      const result = await authService.completeLoginAfter2FA(userId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Resend 2FA OTP
  async resend2FA(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required',
        });
      }

      // Get user email
      const user = await authService.getProfile(userId);
      await twoFactorService.sendOTP(userId, user.email);

      res.json({
        success: true,
        message: 'Verification code sent to your email',
      });
    } catch (error) {
      next(error);
    }
  }

  // Enable 2FA for current user
  async enable2FA(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await twoFactorService.enable2FA(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Disable 2FA for current user
  async disable2FA(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await twoFactorService.disable2FA(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.body;
      const result = await authService.verifyEmail(token);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, password } = req.body;
      const result = await authService.resetPassword(token, password);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshToken(refreshToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.logout(req.user!.id, refreshToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.getProfile(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
