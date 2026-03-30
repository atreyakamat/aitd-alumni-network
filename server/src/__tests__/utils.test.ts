import { hashPassword, comparePassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken } from '../utils/jwt';
import { UserRole } from '@prisma/client';

describe('Password Utils', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'TestPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePassword', () => {
    it('should return true for correct password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      const isValid = await comparePassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      const isValid = await comparePassword('WrongPassword!', hash);
      
      expect(isValid).toBe(false);
    });
  });
});

describe('JWT Utils', () => {
  const mockUserId = 'test-user-123';
  const mockEmail = 'test@example.com';
  const mockRole: UserRole = 'MEMBER';

  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const token = generateAccessToken(mockUserId, mockEmail, mockRole);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const token = generateRefreshToken(mockUserId);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken(mockUserId, mockEmail, mockRole);
      const decoded = verifyAccessToken(token);
      
      expect(decoded.userId).toBe(mockUserId);
      expect(decoded.email).toBe(mockEmail);
      expect(decoded.userRole).toBe(mockRole);
    });

    it('should throw for invalid token', () => {
      expect(() => verifyAccessToken('invalid-token')).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const token = generateRefreshToken(mockUserId);
      const decoded = verifyRefreshToken(token);
      
      expect(decoded.userId).toBe(mockUserId);
    });

    it('should throw for invalid token', () => {
      expect(() => verifyRefreshToken('invalid-token')).toThrow();
    });
  });
});
