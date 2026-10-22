import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { twoFactorService } from '../services/twoFactorService';
import config from '../config';
import { AppError } from '../middleware/errorHandler';
import type { OAuthUser } from '../config/passport';

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

      // 2FA enabled: send the OTP and return a pending challenge (no session tokens)
      if ('requires2FA' in result && result.requires2FA) {
        await twoFactorService.sendOTP(result.user.id, result.user.email);

        return res.json({
          success: true,
          data: {
            requires2FA: true,
            userId: result.user.id,
            twoFactorToken: result.twoFactorToken,
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
      const { twoFactorToken, otp } = req.body;

      if (!twoFactorToken || !otp) {
        throw new AppError('Verification session and code are required', 400, 'VALIDATION_ERROR');
      }

      // The user is taken from the signed login challenge, never from the request body
      const userId = authService.resolveTwoFactorChallenge(twoFactorToken);
      const isValid = await twoFactorService.verifyOTP(userId, String(otp));

      if (!isValid) {
        throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
      }

      const result = await authService.completeLoginAfter2FA(userId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Resend 2FA OTP
  async resend2FA(req: Request, res: Response, next: NextFunction) {
    try {
      const { twoFactorToken } = req.body;

      if (!twoFactorToken) {
        throw new AppError('Verification session is required', 400, 'VALIDATION_ERROR');
      }

      const userId = authService.resolveTwoFactorChallenge(twoFactorToken);
      await twoFactorService.resendOTP(userId);

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

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;
      const result = await authService.changePassword(req.user!.id, currentPassword, newPassword, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
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

  async getOAuthProviders(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: {
          google: Boolean(config.google.clientId && config.google.clientSecret),
          linkedin: Boolean(config.linkedin.clientId && config.linkedin.clientSecret),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Exchange one-time code for JWT tokens (Security fix)
  async exchangeOAuthCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.body;
      if (!code || typeof code !== 'string') {
        throw new AppError('Exchange code is required', 400, 'VALIDATION_ERROR');
      }
      const result = await authService.exchangeOAuthCode(code);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // OAuth callback handler for Google
  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const oauthUser = req.user as OAuthUser;
      
      if (!oauthUser) {
        return res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
      }

      // Generate a one-time exchange code instead of passing JWTs in URL
      const code = await authService.createOAuthExchangeCode(oauthUser.id);

      // Redirect to frontend with code in URL params
      const redirectUrl = new URL(`${config.frontendUrl}/login`);
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('oauth', 'google');
      if (oauthUser.isNewUser) {
        redirectUrl.searchParams.set('newUser', 'true');
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  }

  // OAuth callback handler for LinkedIn
  async linkedinCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const oauthUser = req.user as OAuthUser;
      
      if (!oauthUser) {
        return res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
      }

      // Generate a one-time exchange code
      const code = await authService.createOAuthExchangeCode(oauthUser.id);

      // Redirect to frontend with code in URL params
      const redirectUrl = new URL(`${config.frontendUrl}/login`);
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('oauth', 'linkedin');
      if (oauthUser.isNewUser) {
        redirectUrl.searchParams.set('newUser', 'true');
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('LinkedIn OAuth callback error:', error);
      res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  }
}

export const authController = new AuthController();
