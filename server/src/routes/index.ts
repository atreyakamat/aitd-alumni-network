import { Router } from 'express';
import passport from '../config/passport';
import { authController } from '../controllers/authController';
import { userController } from '../controllers/userController';
import { searchController } from '../controllers/searchController';
import { postController } from '../controllers/postController';
import { jobController } from '../controllers/jobController';
import { eventController } from '../controllers/eventController';
import { networkController, messageController, notificationController } from '../controllers/socialController';
import { galleryController, newsController, chapterController, marketplaceController } from '../controllers/contentController';
import { membershipController, donationController, transactionController } from '../controllers/paymentController';
import { paymentWebhookController } from '../controllers/paymentWebhookController';
import { inviteController } from '../controllers/inviteController';
import { auditController } from '../controllers/auditController';
import { mentorshipController } from '../controllers/mentorshipController';
import { adminController } from '../controllers/adminController';
import { platformController } from '../controllers/platformController';
import { adminUserController, accountController } from '../controllers/adminUserController';
import { geoController } from '../controllers/geoController';
import { socialFeedController as social } from '../controllers/socialFeedController';
import { collegeVideoController, collegeMagazineController } from '../controllers/collegeContentController';
import { requirementController, referralController, digestController, landingController } from '../controllers/engagementController';
import { authenticate, optionalAuth, isAdmin, isSuperAdmin, isChapterAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { cacheMiddleware } from '../middleware/cache';
import { upload, videoUpload, documentUpload } from '../utils/storage';
import config from '../config';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  refreshTokenSchema,
  updateProfileSchema,
  workExperienceSchema,
  updateWorkExperienceSchema,
  educationSchema,
  updateEducationSchema,
  updateSkillsSchema,
  idParamSchema,
  createPostSchema,
  createJobSchema,
  createEventSchema,
  verify2FASchema,
  resend2FASchema,
  oauthExchangeSchema,
  updateCommentSchema,
  createMarketplaceListingSchema,
  updateMarketplaceListingSchema,
} from '../utils/validators';

const router = Router();

// ============== AUTH ROUTES ==============
router.post('/auth/register', validate(registerSchema), authController.register);
router.post('/auth/login', validate(loginSchema), authController.login);
router.post('/auth/verify-email', validate(verifyEmailSchema), authController.verifyEmail);
router.post('/auth/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/auth/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.post('/auth/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.post('/auth/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/auth/logout', authenticate, authController.logout);
router.get('/auth/me', authenticate, authController.me);
router.get('/auth/oauth/providers', authController.getOAuthProviders);

// 2FA Routes
router.post('/auth/verify-2fa', validate(verify2FASchema), authController.verify2FA);
router.post('/auth/resend-2fa', validate(resend2FASchema), authController.resend2FA);
router.post('/auth/2fa/enable', authenticate, authController.enable2FA);
router.post('/auth/2fa/disable', authenticate, authController.disable2FA);

// OAuth Routes
router.post('/auth/oauth/exchange', validate(oauthExchangeSchema), authController.exchangeOAuthCode);
const isGoogleOAuthConfigured = Boolean(config.google.clientId && config.google.clientSecret);
const isLinkedInOAuthConfigured = Boolean(config.linkedin.clientId && config.linkedin.clientSecret);

if (isGoogleOAuthConfigured) {
  router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
  router.get(
    '/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${config.frontendUrl}/login?error=oauth_failed` }),
    authController.googleCallback
  );
} else {
  router.get('/auth/google', (_req, res) => {
    res.status(503).json({ success: false, error: 'Google OAuth is not configured' });
  });
  router.get('/auth/google/callback', (_req, res) => {
    res.status(503).json({ success: false, error: 'Google OAuth is not configured' });
  });
}

if (isLinkedInOAuthConfigured) {
  router.get('/auth/linkedin', passport.authenticate('linkedin', { session: false }));
  router.get(
    '/auth/linkedin/callback',
    passport.authenticate('linkedin', { session: false, failureRedirect: `${config.frontendUrl}/login?error=oauth_failed` }),
    authController.linkedinCallback
  );
} else {
  router.get('/auth/linkedin', (_req, res) => {
    res.status(503).json({ success: false, error: 'LinkedIn OAuth is not configured' });
  });
  router.get('/auth/linkedin/callback', (_req, res) => {
    res.status(503).json({ success: false, error: 'LinkedIn OAuth is not configured' });
  });
}

// ============== SEARCH ROUTES ==============
router.get('/search', authenticate, searchController.globalSearch);

// ============== USER ROUTES ==============
router.get('/users/stats', userController.getPublicStats);
router.get('/users/notable', userController.getNotableAlumni);
router.get('/users/directory', authenticate, userController.searchDirectory);
router.get('/users/yearbook/:year', authenticate, userController.getYearbook);
router.get('/users/locations', authenticate, userController.getAlumniLocations);
router.get('/users/nearby', authenticate, userController.getNearbyAlumni);

// ============== GEO (place search for the alumni map) ==============
router.get('/geo/search', authenticate, geoController.search);
router.get('/geo/reverse', authenticate, geoController.reverse);
router.get('/users/me/export', authenticate, accountController.exportMyData);
router.delete('/users/me', authenticate, accountController.deleteMyAccount);
router.get('/users/mention-search', authenticate, social.mentionSearch);
router.get('/users/:id', optionalAuth, userController.getProfile);
router.post('/users/:id/follow', authenticate, social.follow);
router.delete('/users/:id/follow', authenticate, social.unfollow);
router.get('/users/:id/followers', authenticate, social.listFollowers);
router.get('/users/:id/following', authenticate, social.listFollowing);
router.get('/users/:id/posts', optionalAuth, social.getUserPosts);
router.patch('/users/profile', authenticate, validate(updateProfileSchema), userController.updateProfile);
router.patch('/users/profile-photo', authenticate, upload.single('photo'), userController.updateProfilePhoto);
router.patch('/users/cover-photo', authenticate, upload.single('photo'), userController.updateCoverPhoto);

// Work Experience
router.post('/users/work-experience', authenticate, validate(workExperienceSchema), userController.addWorkExperience);
router.patch(
  '/users/work-experience/:id',
  authenticate,
  validate(updateWorkExperienceSchema),
  userController.updateWorkExperience
);
router.delete('/users/work-experience/:id', authenticate, validate(idParamSchema), userController.deleteWorkExperience);

// Education
router.post('/users/education', authenticate, validate(educationSchema), userController.addEducation);
router.patch('/users/education/:id', authenticate, validate(updateEducationSchema), userController.updateEducation);
router.delete('/users/education/:id', authenticate, validate(idParamSchema), userController.deleteEducation);

// Skills
router.put('/users/skills', authenticate, validate(updateSkillsSchema), userController.updateSkills);

// ============== POST ROUTES ==============
router.get('/posts', optionalAuth, cacheMiddleware({ ttl: config.cache.feedTtlSeconds }), postController.getFeed);
router.get('/posts/:id', optionalAuth, postController.getPost);
router.post('/posts', authenticate, validate(createPostSchema), postController.createPost);
router.post('/posts/media', authenticate, upload.array('media', 5), postController.uploadMedia);
router.patch('/posts/:id', authenticate, postController.updatePost);
router.delete('/posts/:id', authenticate, postController.deletePost);
router.post('/posts/:id/like', authenticate, postController.likePost);
router.post('/posts/:postId/comments', authenticate, postController.addComment);
router.patch('/comments/:id', authenticate, validate(updateCommentSchema), postController.updateComment);
router.delete('/comments/:id', authenticate, postController.deleteComment);

// ============== SOCIAL (docs/SOCIAL_API.md) ==============
router.get('/feed', authenticate, social.getFeed);
router.get('/saved', authenticate, social.getSaved);
router.get('/hashtags/trending', optionalAuth, social.getTrendingHashtags);
router.get('/hashtags/:tag/posts', optionalAuth, social.getHashtagPosts);
// Bound lazily so suites that mock utils/storage without videoUpload can still build the router
router.post('/posts/video', authenticate, (req, res, next) => videoUpload(req, res, next), social.uploadVideo);
router.post('/posts/:id/react', authenticate, social.reactToPost);
router.get('/posts/:id/reactions', authenticate, social.listPostReactions);
router.get('/posts/:id/comments', optionalAuth, social.listComments);
router.post('/posts/:id/repost', authenticate, social.repost);
router.delete('/posts/:id/repost', authenticate, social.undoRepost);
router.post('/posts/:id/save', authenticate, social.toggleSave);
router.post('/posts/:id/view', optionalAuth, social.recordView);
router.post('/posts/:id/report', authenticate, social.reportPost);
router.get('/comments/:id/replies', optionalAuth, social.listReplies);
router.post('/comments/:id/react', authenticate, social.reactToComment);
router.post('/comments/:id/report', authenticate, social.reportComment);

// ============== JOB ROUTES ==============
router.get('/jobs', optionalAuth, jobController.getJobs);
router.get('/jobs/my', authenticate, jobController.getMyJobs);
router.get('/jobs/:id', optionalAuth, jobController.getJob);
router.post('/jobs', authenticate, validate(createJobSchema), jobController.createJob);
router.patch('/jobs/:id', authenticate, jobController.updateJob);
router.delete('/jobs/:id', authenticate, jobController.deleteJob);
router.post('/jobs/:id/approve', authenticate, isAdmin, jobController.approveJob);
router.post('/jobs/:id/reject', authenticate, isAdmin, jobController.rejectJob);

// ============== EVENT ROUTES ==============
router.get('/events', optionalAuth, eventController.getEvents);
router.get('/events/upcoming', eventController.getUpcomingEvents);
router.get('/events/:id', optionalAuth, eventController.getEvent);
router.get('/events/:id/attendees', authenticate, eventController.getEventAttendees);
router.post('/events', authenticate, isChapterAdmin, validate(createEventSchema), eventController.createEvent);
router.patch('/events/:id', authenticate, eventController.updateEvent);
router.delete('/events/:id', authenticate, eventController.deleteEvent);
router.post('/events/:id/rsvp', authenticate, eventController.rsvpEvent);

// ============== NETWORK ROUTES ==============
router.get('/network/connections', authenticate, networkController.getConnections);
router.get('/network/requests', authenticate, networkController.getPendingRequests);
router.get('/network/suggestions', authenticate, networkController.getSuggestions);
router.post('/network/request/:userId', authenticate, networkController.sendRequest);
router.post('/network/respond/:id', authenticate, networkController.respondToRequest);
router.delete('/network/connection/:id', authenticate, networkController.removeConnection);

// ============== MESSAGE ROUTES ==============
router.get('/messages', authenticate, messageController.getConversations);
router.get('/messages/unread', authenticate, messageController.getUnreadCount);
router.get('/messages/:partnerId', authenticate, messageController.getMessages);
router.post('/messages/:receiverId', authenticate, messageController.sendMessage);
router.post('/messages/request/:id/respond', authenticate, messageController.respondToRequest);
router.post('/messages/:partnerId/read', authenticate, messageController.markAsRead);

// ============== NOTIFICATION ROUTES ==============
router.get('/notifications', authenticate, notificationController.getNotifications);
router.get('/notifications/unread', authenticate, notificationController.getUnreadCount);
router.post('/notifications/read-all', authenticate, notificationController.markAllAsRead);
router.post('/notifications/:id/read', authenticate, notificationController.markAsRead);
router.delete('/notifications/:id', authenticate, notificationController.deleteNotification);

// ============== GALLERY ROUTES ==============
router.get('/gallery/albums', galleryController.getAlbums);
router.get('/gallery/albums/:id', optionalAuth, galleryController.getAlbum);
router.get('/gallery/recent', galleryController.getRecentPhotos);
router.post('/gallery/albums', authenticate, isAdmin, galleryController.createAlbum);
router.patch('/gallery/albums/:id', authenticate, isAdmin, galleryController.updateAlbum);
router.delete('/gallery/albums/:id', authenticate, isAdmin, galleryController.deleteAlbum);

// User photo upload (for batch memories, personal uploads)
router.post('/gallery/albums/:albumId/photos', authenticate, upload.array('photos', 10), galleryController.userAddPhoto);
router.delete('/gallery/photos/:id', authenticate, galleryController.userDeletePhoto);

// Admin-only photo management
router.post('/gallery/photos/admin', authenticate, isAdmin, galleryController.addPhoto);
router.delete('/gallery/photos/admin/:id', authenticate, isAdmin, galleryController.deletePhoto);

// ============== NEWS ROUTES ==============
router.get('/news', optionalAuth, newsController.getArticles);
router.get('/news/latest', newsController.getLatestNews);
router.get('/news/:slug', optionalAuth, newsController.getArticle);
router.post('/news', authenticate, isAdmin, newsController.createArticle);
router.patch('/news/:id', authenticate, isAdmin, newsController.updateArticle);
router.post('/news/:id/publish', authenticate, isAdmin, newsController.publishArticle);
router.post('/news/:id/unpublish', authenticate, isAdmin, newsController.unpublishArticle);
router.delete('/news/:id', authenticate, isAdmin, newsController.deleteArticle);

// ============== COLLEGE VIDEO ROUTES ==============
// Public listing is APPROVED-only; members can submit, admins moderate.
router.get('/videos', optionalAuth, collegeVideoController.list);
router.get('/videos/mine', authenticate, collegeVideoController.mySubmissions);
router.get('/videos/:id', optionalAuth, collegeVideoController.get);
router.post('/videos/upload', authenticate, (req, res, next) => videoUpload(req, res, next), collegeVideoController.uploadFile);
router.post('/videos/upload-thumbnail', authenticate, upload.single('image'), collegeVideoController.uploadThumbnail);
router.post('/videos', authenticate, collegeVideoController.create);
router.patch('/videos/:id', authenticate, isAdmin, collegeVideoController.update);
router.post('/videos/:id/approve', authenticate, isAdmin, collegeVideoController.approve);
router.post('/videos/:id/reject', authenticate, isAdmin, collegeVideoController.reject);
router.delete('/videos/:id', authenticate, collegeVideoController.remove);

// ============== COLLEGE MAGAZINE ROUTES ==============
router.get('/magazine', optionalAuth, collegeMagazineController.list);
router.get('/magazine/:id', optionalAuth, collegeMagazineController.get);
// Bound lazily so suites that mock utils/storage without documentUpload can still build the router
router.post('/magazine/upload-file', authenticate, isAdmin, (req, res, next) => documentUpload.single('file')(req, res, next), collegeMagazineController.uploadFile);
router.post('/magazine/upload-cover', authenticate, isAdmin, upload.single('image'), collegeMagazineController.uploadCover);
router.post('/magazine', authenticate, isAdmin, collegeMagazineController.create);
router.patch('/magazine/:id', authenticate, isAdmin, collegeMagazineController.update);
router.delete('/magazine/:id', authenticate, isAdmin, collegeMagazineController.remove);

// ============== COLLEGE REQUIREMENTS (college posts needs; alumni offer to help) ==============
router.get('/requirements', optionalAuth, requirementController.list);
router.post('/requirements/responses/:responseId/review', authenticate, isAdmin, requirementController.reviewResponse);
router.get('/requirements/:id', optionalAuth, requirementController.get);
router.post('/requirements', authenticate, isAdmin, requirementController.create);
router.patch('/requirements/:id', authenticate, isAdmin, requirementController.update);
router.delete('/requirements/:id', authenticate, isAdmin, requirementController.remove);
router.post('/requirements/:id/respond', authenticate, requirementController.respond);

// ============== JOB REFERRALS ==============
router.get('/referrals/referrers', authenticate, referralController.findReferrers);
router.get('/referrals/received', authenticate, referralController.received);
router.get('/referrals/sent', authenticate, referralController.sent);
router.post('/referrals', authenticate, referralController.create);
router.post('/referrals/:id/respond', authenticate, referralController.respond);

// ============== WEEKLY DIGEST (admin) ==============
router.get('/admin/digest', authenticate, isAdmin, digestController.getSettings);
router.patch('/admin/digest', authenticate, isAdmin, digestController.updateSettings);
router.post('/admin/digest/send', authenticate, isAdmin, digestController.sendNow);
router.post('/admin/digest/test', authenticate, isAdmin, digestController.sendTest);

// ============== LANDING PAGE BUILDER ==============
router.get('/landing', optionalAuth, landingController.publicBlocks);
router.get('/admin/landing', authenticate, isAdmin, landingController.adminBlocks);
router.post('/admin/landing', authenticate, isAdmin, landingController.create);
router.patch('/admin/landing/reorder', authenticate, isAdmin, landingController.reorder);
router.patch('/admin/landing/:id', authenticate, isAdmin, landingController.update);
router.delete('/admin/landing/:id', authenticate, isAdmin, landingController.remove);

// ============== CHAPTER ROUTES ==============
router.get('/chapters', chapterController.getChapters);
router.get('/chapters/my', authenticate, chapterController.getUserChapters);
router.get('/chapters/:id', chapterController.getChapter);
router.get('/chapters/:id/members', authenticate, chapterController.getChapterMembers);
router.post('/chapters', authenticate, isAdmin, chapterController.createChapter);
router.patch('/chapters/:id', authenticate, isChapterAdmin, chapterController.updateChapter);
router.put('/chapters/:id/admin', authenticate, isAdmin, adminUserController.assignChapterAdmin);
router.delete('/chapters/:id', authenticate, isSuperAdmin, chapterController.deleteChapter);
router.post('/chapters/:id/join', authenticate, chapterController.joinChapter);
router.post('/chapters/:id/leave', authenticate, chapterController.leaveChapter);

// ============== MARKETPLACE ROUTES ==============
router.get('/marketplace', optionalAuth, marketplaceController.getListings);
router.get('/marketplace/categories', marketplaceController.getCategories);
router.get('/marketplace/my', authenticate, marketplaceController.getMyListings);
router.get('/marketplace/:id', optionalAuth, marketplaceController.getListing);
router.post('/marketplace/upload-image', authenticate, upload.single('image'), marketplaceController.uploadImage);
router.post('/marketplace', authenticate, validate(createMarketplaceListingSchema), marketplaceController.createListing);
router.patch('/marketplace/:id', authenticate, validate(updateMarketplaceListingSchema), marketplaceController.updateListing);
router.delete('/marketplace/:id', authenticate, marketplaceController.deleteListing);

// ============== MEMBERSHIP ROUTES ==============
router.get('/memberships/tiers', membershipController.getTiers);
router.get('/memberships/tiers/:id', membershipController.getTier);
router.get('/memberships/my', authenticate, membershipController.getMyMembership);
router.get('/memberships/history', authenticate, membershipController.getMembershipHistory);
router.post('/memberships/order', authenticate, membershipController.createOrder);
router.post('/memberships/verify', authenticate, membershipController.verifyPayment);

// Admin membership routes
router.post('/memberships/tiers', authenticate, isAdmin, membershipController.createTier);
router.patch('/memberships/tiers/:id', authenticate, isAdmin, membershipController.updateTier);
router.get('/memberships/members', authenticate, isAdmin, membershipController.getPaidMembers);

// ============== DONATION ROUTES ==============
router.get('/donations/wall', donationController.getDonorsWall);
router.get('/donations/featured', donationController.getFeaturedDonors);
router.get('/donations/chapters', donationController.getChapterDonations);
router.get('/donations/stats', donationController.getStats);
router.get('/donations/leaderboard', donationController.getLeaderboard);
router.get('/donations/my', authenticate, donationController.getMyDonations);
router.post('/donations/order', optionalAuth, donationController.createOrder);
router.post('/donations/verify', optionalAuth, donationController.verifyPayment);

// ============== TRANSACTION ROUTES ==============
router.get('/transactions/my', authenticate, accountController.getMyTransactions);
router.get('/transactions/:id/receipt', authenticate, transactionController.getReceipt);

// ============== PAYMENT WEBHOOK ROUTES ==============
// Public: authenticated by the HMAC signature over the raw body, not by a user session.
router.post('/payments/webhook/razorpay', paymentWebhookController.razorpay);

// ============== INVITE ROUTES ==============
router.get('/invites/verify/:token', inviteController.verifyInvite);
router.get('/invites/sent', authenticate, inviteController.getSentInvites);
router.get('/invites/stats', authenticate, inviteController.getInviteStats);
router.post('/invites/send', authenticate, inviteController.sendInvite);
router.post('/invites/bulk', authenticate, inviteController.sendBulkInvites);
router.post('/invites/generate-link', authenticate, inviteController.generateShareableLink);
router.post('/invites/:token/accept', authenticate, inviteController.acceptInvite);

// ============== MENTORSHIP ROUTES ==============

// Mentor profiles
router.get('/mentorship/mentors', authenticate, mentorshipController.getMentors);
router.get('/mentorship/profile', authenticate, mentorshipController.getMyMentorProfile);
router.get('/mentorship/profile/:userId', authenticate, mentorshipController.getMentorProfile);
router.post('/mentorship/profile', authenticate, mentorshipController.createMentorProfile);
router.patch('/mentorship/profile', authenticate, mentorshipController.updateMentorProfile);
router.delete('/mentorship/profile', authenticate, mentorshipController.deleteMentorProfile);

// Mentorship requests
router.get('/mentorship/requests/mentor', authenticate, mentorshipController.getMyMentorRequests);
router.get('/mentorship/requests/mentee', authenticate, mentorshipController.getMyMenteeRequests);
router.post('/mentorship/request/:mentorId', authenticate, mentorshipController.requestMentorship);
router.post('/mentorship/request/:requestId/respond', authenticate, mentorshipController.respondToRequest);
router.post('/mentorship/request/:requestId/end', authenticate, mentorshipController.endMentorship);

// Mentorship sessions
router.get('/mentorship/request/:requestId/sessions', authenticate, mentorshipController.getSessions);
router.post('/mentorship/request/:requestId/sessions', authenticate, mentorshipController.scheduleSession);
router.post('/mentorship/sessions/:sessionId/complete', authenticate, mentorshipController.completeSession);

// ============== ADMIN ROUTES ==============
router.get('/admin/stats', authenticate, isAdmin, adminController.getStats);
router.get('/platform/readiness', authenticate, isAdmin, platformController.getReadiness);
router.get('/admin/users', authenticate, isAdmin, adminUserController.listUsers);
router.patch('/admin/users/:id/role', authenticate, isAdmin, adminUserController.updateUserRole);
router.patch('/admin/users/:id/status', authenticate, isAdmin, adminUserController.updateUserStatus);
router.get('/admin/jobs/pending', authenticate, isAdmin, adminUserController.getPendingJobs);
router.get('/admin/mentorship/overview', authenticate, isAdmin, adminUserController.getMentorshipOverview);
router.get('/admin/export/:entity', authenticate, isAdmin, adminUserController.exportEntity);

// ============== ADMIN AUDIT ROUTES ==============
router.get('/admin/audit', authenticate, isAdmin, auditController.getLogs);
router.get('/admin/reports', authenticate, isAdmin, social.listReports);
router.patch('/admin/reports/:id', authenticate, isAdmin, social.resolveReport);
router.get('/admin/audit/activity', authenticate, isAdmin, auditController.getRecentActivity);
router.get('/admin/audit/:entityType/:entityId', authenticate, isAdmin, auditController.getEntityHistory);
router.post('/admin/audit/cleanup', authenticate, isSuperAdmin, auditController.cleanupOldLogs);

export default router;
