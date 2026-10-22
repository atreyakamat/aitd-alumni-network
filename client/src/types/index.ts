import type { Role } from '@/lib/roles';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  coverPhotoUrl?: string;
  bio?: string;
  headline?: string;
  phone?: string;
  batchYear: number;
  department: string;
  degree: string;
  role: UserRole;
  membershipTierId?: string;
  membershipTier?: MembershipTier;
  isVerified: boolean;
  isProfilePublic: boolean;
  profileCompleteness: number;
  currentCity?: string;
  currentCountry?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  websiteUrl?: string;
  lastActive?: string;
  createdAt: string;
  updatedAt: string;
  workExperiences: WorkExperience[];
  educations: Education[];
  skills: UserSkill[];
}

/** Canonical role; normalize raw values with `normalizeRole` from '@/lib/roles'. */
export type UserRole = Role;

export interface WorkExperience {
  id: string;
  userId: string;
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isCurrent: boolean;
  description?: string;
}

export interface Education {
  id: string;
  userId: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startYear: number;
  endYear?: number;
  grade?: string;
  activities?: string;
}

export interface UserSkill {
  id: string;
  userId: string;
  skill: Skill;
}

export interface Skill {
  id: string;
  name: string;
}

export interface MembershipTier {
  id: string;
  name: string;
  slug: string;
  price: number;
  durationMonths: number;
  features: string[];
  benefits: string[];
  isActive: boolean;
}

export interface Post {
  id: string;
  authorId: string;
  author: User;
  type: PostType;
  content: string;
  mediaUrls: string[];
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  isPinned: boolean;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
  comments: PostComment[];
}

export type PostType = 'UPDATE' | 'ACHIEVEMENT' | 'ANNOUNCEMENT' | 'POLL';

/** Commenter as returned by the API (`commenterSelect` on the server). */
export interface PostCommentUser {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
}

export interface PostComment {
  id: string;
  postId: string;
  userId: string;
  user: PostCommentUser;
  content: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt?: string;
  replies?: PostComment[];
}

export interface Job {
  id: string;
  postedById: string;
  postedBy: User;
  title: string;
  company: string;
  companyLogoUrl?: string;
  location?: string;
  type: JobType;
  description: string;
  requirements: string[];
  salaryMin?: number;
  salaryMax?: number;
  applicationUrl?: string;
  contactEmail?: string;
  isRemote: boolean;
  expiresAt?: string;
  isApproved: boolean;
  createdAt: string;
}

export type JobType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'FREELANCE';

export interface Event {
  id: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  location?: string;
  isVirtual: boolean;
  meetingUrl?: string;
  startDate: string;
  endDate: string;
  maxAttendees?: number;
  attendeesCount: number;
  isUserRSVPed: boolean;
  type: EventType;
  createdById: string;
  createdBy: User;
  isApproved: boolean;
  createdAt: string;
}

export type EventType = 'REUNION' | 'WORKSHOP' | 'WEBINAR' | 'MEETUP' | 'CONFERENCE' | 'OTHER';

export interface Connection {
  id: string;
  requesterId: string;
  requester?: User;
  addresseeId: string;
  addressee?: User;
  status: ConnectionStatus;
  createdAt: string;
}

export type ConnectionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface Message {
  id: string;
  senderId: string;
  sender: User;
  receiverId: string;
  receiver: User;
  content: string;
  mediaUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Server field (Prisma `Notification.link`), usually an app path like `/events/:id`. */
  link?: string | null;
  /** @deprecated legacy alias of `link`. */
  linkUrl?: string;
  isRead: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** Mirrors the server's Prisma `NotificationType` enum. */
export type NotificationType =
  | 'CONNECTION_REQUEST'
  | 'CONNECTION_ACCEPTED'
  | 'MESSAGE_RECEIVED'
  | 'POST_LIKED'
  | 'POST_COMMENTED'
  | 'EVENT_RSVP'
  | 'MEMBERSHIP_EXPIRY'
  | 'JOB_MATCH'
  | 'ADMIN_ANNOUNCEMENT'
  | 'MENTION'
  | 'MENTORSHIP_REQUEST'
  | 'MENTORSHIP_ACCEPTED'
  | 'MENTORSHIP_DECLINED'
  | 'MENTORSHIP_SESSION'
  | 'POST_REACTED'
  | 'COMMENT_REPLIED'
  | 'COMMENT_REACTED'
  | 'POST_REPOSTED'
  | 'NEW_FOLLOWER'
  | 'CONTENT_REPORTED';

export interface GalleryAlbum {
  id: string;
  title: string;
  description?: string;
  coverPhotoUrl?: string;
  type: AlbumType;
  year?: number;
  photosCount: number;
  createdById: string;
  createdBy: User;
  isApproved: boolean;
  createdAt: string;
  photos?: GalleryPhoto[];
}

export type AlbumType = 'EVENT' | 'REUNION' | 'CAMPUS' | 'THROWBACK' | 'OTHER';

export interface GalleryPhoto {
  id: string;
  albumId: string;
  url: string;
  caption?: string;
  uploadedById: string;
  uploadedBy: User;
  createdAt: string;
}

/** Minimal user projection embedded by news/chapter endpoints. */
export interface PersonSummary {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  currentDesignation?: string | null;
}

/** Mirrors server `NewsArticle` (GET /news, GET /news/:slug). */
export interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  /** May contain admin-authored HTML; never render it unsanitized. */
  content: string;
  featuredImage?: string | null;
  authorId: string;
  author?: PersonSummary | null;
  category: NewsCategory;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readingTime?: number | null;
  viewCount: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** Server `NewsCategory` enum. */
export type NewsCategory = 'EVENT_RECAP' | 'ALUMNI_STORY' | 'INSTITUTE_UPDATE' | 'NEWSLETTER';

/** Mirrors server `Chapter` (GET /chapters, /chapters/my, /chapters/:id). */
export interface Chapter {
  id: string;
  name: string;
  description?: string | null;
  region: string;
  adminUserId?: string | null;
  admin?: PersonSummary | null;
  logoUrl?: string | null;
  memberCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  _count?: { memberships: number; events: number };
  /** Only on GET /chapters/my. */
  joinedAt?: string;
}

/** Upcoming published event embedded in GET /chapters/:id. */
export interface ChapterEventSummary {
  id: string;
  title: string;
  startDate: string;
  endDate?: string | null;
  eventType?: string;
  venue?: string | null;
  city?: string | null;
}

export interface ChapterDetail extends Chapter {
  events: ChapterEventSummary[];
}

/** Row of GET /chapters/:id/members. */
export interface ChapterMember {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  batchYear?: number | null;
  currentDesignation?: string | null;
  city?: string | null;
  joinedAt: string;
}

export interface Donation {
  id: string;
  donorId: string;
  donor: User;
  amount: number;
  currency: string;
  purpose?: string;
  chapterId?: string;
  chapter?: Chapter;
  paymentId?: string;
  orderId?: string;
  isAnonymous: boolean;
  message?: string;
  status: DonationStatus;
  createdAt: string;
}

export type DonationStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

/** Server MarketplaceListingType enum. */
export type MarketplaceListingType = 'BUSINESS' | 'SERVICE' | 'REQUIREMENT';

/** Owner summary included with listings (GET /marketplace, GET /marketplace/:id). */
export interface MarketplaceListingOwner {
  id: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  batchYear?: number | null;
  city?: string | null;
  currentDesignation?: string | null;
  membershipTier?: { name: string; badgeColor?: string | null } | null;
}

/** Mirrors MarketplaceListing in server/prisma/schema.prisma. */
export interface MarketplaceListing {
  id: string;
  userId: string;
  type: MarketplaceListingType;
  title: string;
  category: string;
  description: string;
  location?: string | null;
  website?: string | null;
  contactInfo?: string | null;
  /** Free text, e.g. "INR 500-2,000 / hour". */
  priceRange?: string | null;
  isActive: boolean;
  isFeatured: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  /** Absent on GET /marketplace/my. */
  user?: MarketplaceListingOwner;
}

/** GET /marketplace/categories item (active listings only). */
export interface MarketplaceCategory {
  name: string;
  count: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
