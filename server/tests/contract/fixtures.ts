/**
 * Database fixtures for the contract suite: one user per role plus a connected pair, and factories that
 * mint a fresh record for routes that destroy or consume what they act on (DELETE, respond, approve ...).
 */
import { UserRole } from '@prisma/client';
import { createUser, prisma, uniqueEmail } from '../integration/helpers';

export { prisma, uniqueEmail };

export type Actor = Awaited<ReturnType<typeof createUser>>;

let seq = 0;
export const uniq = (prefix = 'x') => `${prefix}-${Date.now().toString(36)}-${++seq}`;

export const futureDate = (days = 30) => new Date(Date.now() + days * 24 * 3600 * 1000);

export const makeUsers = async () => {
  const [member, other, third, admin, superAdmin, chapterAdmin] = await Promise.all([
    createUser('MEMBER' as UserRole),
    createUser('MEMBER' as UserRole),
    createUser('MEMBER' as UserRole),
    createUser('ADMIN' as UserRole),
    createUser('SUPER_ADMIN' as UserRole),
    createUser('CHAPTER_ADMIN' as UserRole),
  ]);
  await prisma.connection.create({ data: { requesterId: member.user.id, addresseeId: other.user.id, status: 'ACCEPTED' } });
  return { member, other, third, admin, superAdmin, chapterAdmin };
};
export type Users = Awaited<ReturnType<typeof makeUsers>>;

export const newUser = (role: UserRole = 'MEMBER' as UserRole) => createUser(role);

export const newPost = (userId: string, overrides: Record<string, unknown> = {}) =>
  prisma.post.create({ data: { userId, content: `Contract post ${uniq()}`, ...overrides } as any });

export const newComment = (userId: string, postId: string, overrides: Record<string, unknown> = {}) =>
  prisma.postComment.create({ data: { userId, postId, content: `Contract comment ${uniq()}`, ...overrides } as any });

export const newJob = (postedById: string, status: 'PUBLISHED' | 'PENDING_REVIEW' | 'DRAFT' = 'PUBLISHED') =>
  prisma.jobOpportunity.create({
    data: { postedById, title: `Contract job ${uniq()}`, description: 'A contract-test job', company: 'Contract Co', status },
  });

export const newChapter = (adminUserId?: string) =>
  prisma.chapter.create({ data: { name: uniq('Chapter'), region: 'Pune', description: 'Contract chapter', adminUserId } });

export const newEvent = (createdById: string, chapterId?: string, overrides: Record<string, unknown> = {}) =>
  prisma.event.create({
    data: {
      title: `Contract event ${uniq()}`,
      description: 'A contract-test event',
      startDate: futureDate(14),
      status: 'PUBLISHED',
      createdById,
      chapterId,
      ...overrides,
    } as any,
  });

export const newAlbum = (overrides: Record<string, unknown> = {}) =>
  prisma.galleryAlbum.create({ data: { title: `Contract album ${uniq()}`, albumType: 'INSTITUTIONAL', ...overrides } as any });

export const newPhoto = (albumId: string, uploadedById: string) =>
  prisma.galleryPhoto.create({ data: { albumId, uploadedById, url: '/uploads/gallery/contract.png', caption: 'Contract photo' } });

export const newArticle = (authorId: string, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') => {
  const slug = uniq('article');
  return prisma.newsArticle.create({
    data: {
      title: `Contract article ${slug}`,
      slug,
      content: 'Contract article body. '.repeat(10),
      excerpt: 'Contract excerpt',
      authorId,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    },
  });
};

export const newListing = (userId: string) =>
  prisma.marketplaceListing.create({
    data: { userId, type: 'SERVICE', title: `Contract listing ${uniq()}`, category: 'Consulting', description: 'A contract-test marketplace listing' },
  });

export const newTier = () =>
  prisma.membershipTier.create({ data: { name: uniq('Tier'), priceInr: 500, durationMonths: 12, benefits: ['Badge'], isActive: true } });

export const newNotification = (userId: string) =>
  prisma.notification.create({ data: { userId, type: 'ADMIN_ANNOUNCEMENT', title: 'Contract', message: 'Contract notification' } });

export const newMentor = async (userId: string) =>
  prisma.mentorProfile.create({ data: { userId, focusAreas: ['Careers'], availability: 'Weekends', bio: 'Contract mentor', maxMentees: 5 } });

export const newMentorshipRequest = async (menteeId: string, mentorId: string, status = 'PENDING') => {
  const profile = (await prisma.mentorProfile.findUnique({ where: { userId: mentorId } })) ?? (await newMentor(mentorId));
  return prisma.mentorshipRequest.create({ data: { menteeId, mentorId, profileId: profile.id, message: 'Please mentor me', status } });
};

export const newSession = (requestId: string) =>
  prisma.mentorshipSession.create({ data: { requestId, scheduledAt: futureDate(7), notes: 'Contract session' } });

export const newConnection = (requesterId: string, addresseeId: string, status: 'PENDING' | 'ACCEPTED' = 'PENDING') =>
  prisma.connection.create({ data: { requesterId, addresseeId, status } });

export const newMessage = (senderId: string, receiverId: string) =>
  prisma.message.create({ data: { senderId, receiverId, content: 'Contract message' } });

export const newWork = (userId: string) =>
  prisma.workExperience.create({ data: { userId, company: 'Contract Co', role: 'Engineer', startDate: new Date('2020-01-01') } });

export const newEducation = (userId: string) =>
  prisma.education.create({ data: { userId, institution: 'AITD', degree: 'B.E.', startYear: 2014 } });

/** A 1x1 PNG, enough for multer's image checks. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
