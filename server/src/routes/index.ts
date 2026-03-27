import { Router } from 'express';
import { authController } from '../controllers/authController';
import { userController } from '../controllers/userController';
import { postController } from '../controllers/postController';
import { jobController } from '../controllers/jobController';
import { eventController } from '../controllers/eventController';
import { networkController, messageController, notificationController } from '../controllers/socialController';
import { galleryController, newsController, chapterController, marketplaceController } from '../controllers/contentController';
import { membershipController, donationController } from '../controllers/paymentController';
import { authenticate, optionalAuth, isAdmin, isSuperAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  refreshTokenSchema,
  updateProfileSchema,
  createPostSchema,
  createJobSchema,
  createEventSchema,
} from '../utils/validators';

const router = Router();

// ============== AUTH ROUTES ==============
router.post('/auth/register', validate(registerSchema), authController.register);
router.post('/auth/login', validate(loginSchema), authController.login);
router.post('/auth/verify-email', validate(verifyEmailSchema), authController.verifyEmail);
router.post('/auth/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/auth/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.post('/auth/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/auth/logout', authenticate, authController.logout);
router.get('/auth/me', authenticate, authController.me);

// ============== USER ROUTES ==============
router.get('/users/stats', userController.getPublicStats);
router.get('/users/directory', authenticate, userController.searchDirectory);
router.get('/users/yearbook/:year', authenticate, userController.getYearbook);
router.get('/users/locations', authenticate, userController.getAlumniLocations);
router.get('/users/:id', optionalAuth, userController.getProfile);
router.patch('/users/profile', authenticate, validate(updateProfileSchema), userController.updateProfile);

// Work Experience
router.post('/users/work-experience', authenticate, userController.addWorkExperience);
router.patch('/users/work-experience/:id', authenticate, userController.updateWorkExperience);
router.delete('/users/work-experience/:id', authenticate, userController.deleteWorkExperience);

// Education
router.post('/users/education', authenticate, userController.addEducation);
router.patch('/users/education/:id', authenticate, userController.updateEducation);
router.delete('/users/education/:id', authenticate, userController.deleteEducation);

// Skills
router.put('/users/skills', authenticate, userController.updateSkills);

// ============== POST ROUTES ==============
router.get('/posts', optionalAuth, postController.getFeed);
router.get('/posts/:id', optionalAuth, postController.getPost);
router.post('/posts', authenticate, validate(createPostSchema), postController.createPost);
router.patch('/posts/:id', authenticate, postController.updatePost);
router.delete('/posts/:id', authenticate, postController.deletePost);
router.post('/posts/:id/like', authenticate, postController.likePost);
router.post('/posts/:postId/comments', authenticate, postController.addComment);
router.delete('/comments/:id', authenticate, postController.deleteComment);

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
router.post('/events', authenticate, isAdmin, validate(createEventSchema), eventController.createEvent);
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
router.get('/gallery/albums/:id', galleryController.getAlbum);
router.get('/gallery/recent', galleryController.getRecentPhotos);
router.post('/gallery/albums', authenticate, isAdmin, galleryController.createAlbum);
router.patch('/gallery/albums/:id', authenticate, isAdmin, galleryController.updateAlbum);
router.delete('/gallery/albums/:id', authenticate, isAdmin, galleryController.deleteAlbum);
router.post('/gallery/albums/:albumId/photos', authenticate, isAdmin, galleryController.addPhoto);
router.delete('/gallery/photos/:id', authenticate, isAdmin, galleryController.deletePhoto);

// ============== NEWS ROUTES ==============
router.get('/news', newsController.getArticles);
router.get('/news/latest', newsController.getLatestNews);
router.get('/news/:slug', newsController.getArticle);
router.post('/news', authenticate, isAdmin, newsController.createArticle);
router.patch('/news/:id', authenticate, isAdmin, newsController.updateArticle);
router.post('/news/:id/publish', authenticate, isAdmin, newsController.publishArticle);
router.post('/news/:id/unpublish', authenticate, isAdmin, newsController.unpublishArticle);
router.delete('/news/:id', authenticate, isAdmin, newsController.deleteArticle);

// ============== CHAPTER ROUTES ==============
router.get('/chapters', chapterController.getChapters);
router.get('/chapters/my', authenticate, chapterController.getUserChapters);
router.get('/chapters/:id', chapterController.getChapter);
router.get('/chapters/:id/members', authenticate, chapterController.getChapterMembers);
router.post('/chapters', authenticate, isAdmin, chapterController.createChapter);
router.patch('/chapters/:id', authenticate, isAdmin, chapterController.updateChapter);
router.delete('/chapters/:id', authenticate, isSuperAdmin, chapterController.deleteChapter);
router.post('/chapters/:id/join', authenticate, chapterController.joinChapter);
router.post('/chapters/:id/leave', authenticate, chapterController.leaveChapter);

// ============== MARKETPLACE ROUTES ==============
router.get('/marketplace', optionalAuth, marketplaceController.getListings);
router.get('/marketplace/categories', marketplaceController.getCategories);
router.get('/marketplace/my', authenticate, marketplaceController.getMyListings);
router.get('/marketplace/:id', optionalAuth, marketplaceController.getListing);
router.post('/marketplace', authenticate, marketplaceController.createListing);
router.patch('/marketplace/:id', authenticate, marketplaceController.updateListing);
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
router.get('/donations/my', authenticate, donationController.getMyDonations);
router.post('/donations/order', optionalAuth, donationController.createOrder);
router.post('/donations/verify', optionalAuth, donationController.verifyPayment);

export default router;
