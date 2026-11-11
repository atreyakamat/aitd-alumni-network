import { randomBytes } from 'crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import prisma from '../../src/config/database';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/utils/password';
import { generateAccessToken } from '../../src/utils/jwt';

export { prisma };

export const app = createApp({ disableRateLimit: true });
export const http = () => request(app);

let counter = 0;
// The random part matters: Jest workers are separate processes with their own counter, so time + counter alone can repeat
// when two workers create a user in the same millisecond.
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++counter}.${randomBytes(4).toString('hex')}@aiem.test`;

export const PASSWORD = 'Str0ng!Passw0rd';

/** Insert a verified, approved, active user directly and return it with a bearer header. */
export const createUser = async (role: UserRole = 'MEMBER', overrides: Record<string, unknown> = {}) => {
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail(role.toLowerCase()),
      passwordHash: await hashPassword(PASSWORD),
      fullName: `Integration ${role}`,
      batchYear: 2018,
      department: 'Computer Engineering',
      degree: 'B.E.',
      userRole: role,
      isVerified: true,
      approvalStatus: 'APPROVED',
      emailVerifiedAt: new Date(),
      ...overrides,
    },
  });
  return { user, auth: `Bearer ${generateAccessToken(user.id, user.email, user.userRole)}` };
};
