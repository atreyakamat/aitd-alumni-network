import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import prisma from './database';
import { config } from './index';
import { RoleType, UserRole } from '@prisma/client';
import { disconnectUser } from '../utils/socket';
import { sanitizeValue } from '../middleware/sanitizeInput';
import { isSafeHttpUrl } from '../utils/safeUrl';

// Define OAuth user type for callback responses
export interface OAuthUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string;
  isNewUser: boolean;
}

export type OAuthProvider = 'google' | 'linkedin';

type OAuthProfile = Pick<GoogleProfile, 'id' | 'displayName' | 'photos'> & {
  emails?: Array<{ value: string; verified?: boolean | string }>;
  name?: { givenName?: string; familyName?: string };
};

type VerifyDone = (error: Error | null, user?: Express.User | false) => void;

// Default values for OAuth users who haven't filled their profile yet
const oauthUserDefaults = () => ({
  batchYear: new Date().getFullYear(), // Current year as placeholder
  department: 'Not Specified',
  degree: 'Not Specified',
});

const providerLabel: Record<OAuthProvider, string> = { google: 'Google', linkedin: 'LinkedIn' };

const MAX_DISPLAY_NAME_LENGTH = 100;

// A provider's display name is chosen by whoever owns that account, and it never passed through sanitizeInput (it is
// not part of a request): strip markup and bound the length like any other name.
const displayNameFor = (provider: OAuthProvider, profile: OAuthProfile, email: string) => {
  const clean = (name: string | undefined) => String(sanitizeValue(name ?? '')).slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
  const named = clean(profile.displayName);
  if (named) return named;
  if (provider === 'linkedin') {
    const composed = clean(`${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`);
    if (composed) return composed;
  }
  return clean(email.split('@')[0]) || 'Member';
};

/**
 * Find or create the local account for a provider profile.
 * Only provider-verified emails are trusted for account linking.
 */
export const resolveOAuthUser = async (provider: OAuthProvider, profile: OAuthProfile): Promise<OAuthUser> => {
  const primary = profile.emails?.[0];
  const email = primary?.value?.trim().toLowerCase();
  if (!email) {
    throw new Error(`No email found in ${providerLabel[provider]} profile`);
  }
  // Linking by an unverified email would let anyone take over the matching account
  if (primary?.verified === false || primary?.verified === 'false') {
    throw new Error(`${providerLabel[provider]} email is not verified`);
  }

  const linkedinUrl = provider === 'linkedin' ? `https://linkedin.com/in/${profile.id}` : undefined;

  let user = await prisma.user.findUnique({ where: { email } });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = await prisma.user.create({
      data: {
        email,
        fullName: displayNameFor(provider, profile, email),
        profilePhotoUrl: isSafeHttpUrl(profile.photos?.[0]?.value) ? profile.photos![0].value : undefined,
        passwordHash: '', // No password for OAuth users
        emailVerifiedAt: new Date(), // Provider already verified
        isActive: true,
        isVerified: false, // Needs admin verification
        roleType: RoleType.ALUMNI,
        userRole: UserRole.MEMBER,
        ...(linkedinUrl ? { linkedinUrl } : {}),
        ...oauthUserDefaults(),
      },
    });
  } else {
    const adopt = !user.emailVerifiedAt;
    if (adopt || (linkedinUrl && !user.linkedinUrl)) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user!.id },
          data: {
            ...(linkedinUrl && !user!.linkedinUrl ? { linkedinUrl } : {}),
            // The provider has just proven control of this mailbox. Credentials created while the
            // address was still unverified were NOT proven by the owner (anyone can register an
            // address they do not own), so they must not survive the link: drop the password and
            // every session issued before it (pre-hijacking defence).
            ...(adopt
              ? { emailVerifiedAt: new Date(), passwordHash: null, tokenVersion: { increment: 1 } }
              : {}),
          },
        });
        if (adopt) {
          await tx.refreshToken.deleteMany({ where: { userId: user!.id } });
          await tx.verificationToken.deleteMany({ where: { userId: user!.id } });
        }
      });
      if (adopt) disconnectUser(user.id);
    }
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    profilePhotoUrl: user.profilePhotoUrl || undefined,
    isNewUser,
  };
};

/** Passport verify callback shared by all providers. */
export const oauthVerify =
  (provider: OAuthProvider) =>
  async (_accessToken: string, _refreshToken: string, profile: OAuthProfile, done: VerifyDone) => {
    try {
      const oauthUser = await resolveOAuthUser(provider, profile);
      return done(null, oauthUser as Express.User);
    } catch (error) {
      console.error(`${providerLabel[provider]} OAuth error:`, error);
      return done(error as Error, undefined);
    }
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
      oauthVerify('google') as any
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
      oauthVerify('linkedin') as any
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
