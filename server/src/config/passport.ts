import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
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

const displayNameFor = (provider: OAuthProvider, profile: OAuthProfile, email: string) => {
  if (profile.displayName) return profile.displayName;
  if (provider === 'linkedin') {
    const composed = `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim();
    if (composed) return composed;
  }
  return email.split('@')[0];
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
        profilePhotoUrl: profile.photos?.[0]?.value,
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
  } else if (linkedinUrl && !user.linkedinUrl) {
    await prisma.user.update({
      where: { id: user.id },
      data: { linkedinUrl },
    });
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
