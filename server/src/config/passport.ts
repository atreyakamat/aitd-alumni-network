import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as LinkedInStrategy, Profile as LinkedInProfile } from 'passport-linkedin-oauth2';
import prisma from './database';
import { config } from './index';
import { RoleType, UserRole } from '@prisma/client';

// Define OAuth user type for callback responses
export interface OAuthUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string;
  isNewUser: boolean;
}

// Default values for OAuth users who haven't filled their profile yet
const OAUTH_USER_DEFAULTS = {
  batchYear: new Date().getFullYear(), // Current year as placeholder
  department: 'Not Specified',
  degree: 'Not Specified',
};

// Google OAuth Strategy
if (config.google.clientId && config.google.clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile: GoogleProfile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email found in Google profile'), undefined);
          }

          // Check if user exists
          let user = await prisma.user.findUnique({
            where: { email },
          });

          let isNewUser = false;

          if (!user) {
            // Create new user from Google profile
            isNewUser = true;
            user = await prisma.user.create({
              data: {
                email,
                fullName: profile.displayName || email.split('@')[0],
                profilePhotoUrl: profile.photos?.[0]?.value,
                passwordHash: '', // No password for OAuth users
                emailVerifiedAt: new Date(), // Google already verified
                isActive: true,
                isVerified: false, // Needs admin verification
                roleType: RoleType.ALUMNI,
                userRole: UserRole.MEMBER,
                ...OAUTH_USER_DEFAULTS,
              },
            });
          }

          const oauthUser: OAuthUser = {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            profilePhotoUrl: user.profilePhotoUrl || undefined,
            isNewUser,
          };

          return done(null, oauthUser as Express.User);
        } catch (error) {
          console.error('Google OAuth error:', error);
          return done(error as Error, undefined);
        }
      }
    )
  );
}

// LinkedIn OAuth Strategy
if (config.linkedin.clientId && config.linkedin.clientSecret) {
  passport.use(
    new LinkedInStrategy(
      {
        clientID: config.linkedin.clientId,
        clientSecret: config.linkedin.clientSecret,
        callbackURL: config.linkedin.callbackUrl,
        scope: ['openid', 'profile', 'email'],
      },
      async (accessToken: string, refreshToken: string, profile: LinkedInProfile, done: (error: Error | null, user?: Express.User) => void) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email found in LinkedIn profile'));
          }

          // Check if user exists
          let user = await prisma.user.findUnique({
            where: { email },
          });

          let isNewUser = false;

          if (!user) {
            // Create new user from LinkedIn profile
            isNewUser = true;
            user = await prisma.user.create({
              data: {
                email,
                fullName: profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || email.split('@')[0],
                profilePhotoUrl: profile.photos?.[0]?.value,
                passwordHash: '', // No password for OAuth users
                emailVerifiedAt: new Date(), // LinkedIn already verified
                isActive: true,
                isVerified: false, // Needs admin verification
                roleType: RoleType.ALUMNI,
                userRole: UserRole.MEMBER,
                linkedinUrl: `https://linkedin.com/in/${profile.id}`,
                ...OAUTH_USER_DEFAULTS,
              },
            });
          } else {
            // Update LinkedIn URL if not set
            if (!user.linkedinUrl) {
              await prisma.user.update({
                where: { id: user.id },
                data: { linkedinUrl: `https://linkedin.com/in/${profile.id}` },
              });
            }
          }

          const oauthUser: OAuthUser = {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            profilePhotoUrl: user.profilePhotoUrl || undefined,
            isNewUser,
          };

          return done(null, oauthUser as Express.User);
        } catch (error) {
          console.error('LinkedIn OAuth error:', error);
          return done(error as Error);
        }
      }
    )
  );
}

// Serialize user for session (we're not using sessions, but passport requires this)
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});

export default passport;
