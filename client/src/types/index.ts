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

export type UserRole = 'MEMBER' | 'CHAPTER_ADMIN' | 'ADMIN' | 'SUPER_ADMIN';

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

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  author: User;
  content: string;
  parentId?: string;
  createdAt: string;
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
  linkUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export type NotificationType = 
  | 'CONNECTION_REQUEST'
  | 'CONNECTION_ACCEPTED'
  | 'NEW_MESSAGE'
  | 'NEW_COMMENT'
  | 'NEW_LIKE'
  | 'NEW_FOLLOWER'
  | 'JOB_POSTED'
  | 'EVENT_REMINDER'
  | 'MEMBERSHIP_EXPIRING'
  | 'GENERAL';

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

export interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  coverImageUrl?: string;
  authorId: string;
  author: User;
  category: NewsCategory;
  tags: string[];
  viewsCount: number;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
}

export type NewsCategory = 'ALUMNI_SPOTLIGHT' | 'COLLEGE_NEWS' | 'INDUSTRY' | 'EVENTS' | 'GENERAL';

export interface Chapter {
  id: string;
  name: string;
  slug: string;
  description?: string;
  coverImageUrl?: string;
  city: string;
  country: string;
  membersCount: number;
  leadId?: string;
  lead?: User;
  isActive: boolean;
  createdAt: string;
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

export interface MarketplaceListing {
  id: string;
  sellerId: string;
  seller: User;
  title: string;
  description: string;
  price?: number;
  category: MarketplaceCategory;
  imageUrls: string[];
  condition: ItemCondition;
  location?: string;
  isNegotiable: boolean;
  status: ListingStatus;
  createdAt: string;
}

export type MarketplaceCategory = 'BOOKS' | 'ELECTRONICS' | 'FURNITURE' | 'SERVICES' | 'OTHER';
export type ItemCondition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR';
export type ListingStatus = 'ACTIVE' | 'SOLD' | 'EXPIRED' | 'REMOVED';

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
