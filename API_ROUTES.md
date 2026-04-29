# AITD Alumni Network - API Routes Documentation

## Complete API Endpoint Reference

### Base URL: `https://api.aitd.stixnvibes.com/api`

---

## Authentication Routes

### Register User
- **Method**: `POST`
- **Endpoint**: `/auth/register`
- **Authentication**: None
- **Rate Limit**: 10 requests/15 min
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePass123",
    "firstName": "John",
    "lastName": "Doe",
    "graduationYear": 2020,
    "batch": "B.Tech"
  }
  ```
- **Response**: `{ token, refreshToken, user }`

### Login User
- **Method**: `POST`
- **Endpoint**: `/auth/login`
- **Authentication**: None
- **Rate Limit**: 10 requests/15 min
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePass123"
  }
  ```
- **Response**: `{ token, refreshToken, user }`

### Verify Email
- **Method**: `POST`
- **Endpoint**: `/auth/verify-email`
- **Authentication**: None
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "verificationCode": "123456"
  }
  ```

### Forgot Password
- **Method**: `POST`
- **Endpoint**: `/auth/forgot-password`
- **Authentication**: None
- **Rate Limit**: 10 requests/15 min
- **Request Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```

### Reset Password
- **Method**: `POST`
- **Endpoint**: `/auth/reset-password`
- **Authentication**: None
- **Request Body**:
  ```json
  {
    "token": "reset_token",
    "newPassword": "NewSecurePass123"
  }
  ```

### Refresh Token
- **Method**: `POST`
- **Endpoint**: `/auth/refresh-token`
- **Authentication**: None
- **Request Body**:
  ```json
  {
    "refreshToken": "refresh_token_value"
  }
  ```

### Get Current User
- **Method**: `GET`
- **Endpoint**: `/auth/me`
- **Authentication**: Required (JWT)
- **Response**: `{ user }`

### Logout
- **Method**: `POST`
- **Endpoint**: `/auth/logout`
- **Authentication**: Required (JWT)

### OAuth Providers
- **Method**: `GET`
- **Endpoint**: `/auth/oauth/providers`
- **Authentication**: None
- **Response**: Available OAuth providers (Google, LinkedIn)

### Verify 2FA
- **Method**: `POST`
- **Endpoint**: `/auth/verify-2fa`
- **Request Body**: `{ code, email }`

### Enable 2FA
- **Method**: `POST`
- **Endpoint**: `/auth/2fa/enable`
- **Authentication**: Required

### Disable 2FA
- **Method**: `POST`
- **Endpoint**: `/auth/2fa/disable`
- **Authentication**: Required

### Google OAuth Callback
- **Method**: `GET`
- **Endpoint**: `/auth/google`
- **Endpoint**: `/auth/google/callback`

### LinkedIn OAuth Callback
- **Method**: `GET`
- **Endpoint**: `/auth/linkedin`
- **Endpoint**: `/auth/linkedin/callback`

---

## User Routes

### Get User Profile
- **Method**: `GET`
- **Endpoint**: `/users/:id`
- **Authentication**: Optional (better data if authenticated)
- **Response**: User profile with work experience, education, skills

### Update Profile
- **Method**: `PATCH`
- **Endpoint**: `/users/profile`
- **Authentication**: Required
- **Request Body**: User profile fields
- **Response**: Updated user object

### Update Profile Photo
- **Method**: `PATCH`
- **Endpoint**: `/users/profile-photo`
- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **File**: Profile photo (single file)

### Update Cover Photo
- **Method**: `PATCH`
- **Endpoint**: `/users/cover-photo`
- **Authentication**: Required
- **Content-Type**: `multipart/form-data`

### Add Work Experience
- **Method**: `POST`
- **Endpoint**: `/users/work-experience`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "company": "Acme Corp",
    "position": "Senior Developer",
    "startDate": "2020-01-01",
    "endDate": "2023-12-31",
    "description": "Led development team"
  }
  ```

### Update Work Experience
- **Method**: `PATCH`
- **Endpoint**: `/users/work-experience/:id`
- **Authentication**: Required

### Delete Work Experience
- **Method**: `DELETE`
- **Endpoint**: `/users/work-experience/:id`
- **Authentication**: Required

### Add Education
- **Method**: `POST`
- **Endpoint**: `/users/education`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "school": "IIT Delhi",
    "degree": "B.Tech",
    "field": "Computer Science",
    "startDate": "2016-07-01",
    "endDate": "2020-05-31"
  }
  ```

### Update Education
- **Method**: `PATCH`
- **Endpoint**: `/users/education/:id`
- **Authentication**: Required

### Delete Education
- **Method**: `DELETE`
- **Endpoint**: `/users/education/:id`
- **Authentication**: Required

### Update Skills
- **Method**: `PUT`
- **Endpoint**: `/users/skills`
- **Authentication**: Required
- **Request Body**: `{ skills: ["JavaScript", "Python", "React"] }`

### Get Public Stats
- **Method**: `GET`
- **Endpoint**: `/users/stats`
- **Authentication**: None
- **Response**: Platform statistics

### Get Notable Alumni
- **Method**: `GET`
- **Endpoint**: `/users/notable`
- **Authentication**: None
- **Response**: List of notable alumni

### Search Directory
- **Method**: `GET`
- **Endpoint**: `/users/directory?search=name&batch=2020`
- **Authentication**: Required
- **Response**: Filtered user list

### Get Yearbook
- **Method**: `GET`
- **Endpoint**: `/users/yearbook/:year`
- **Authentication**: Required
- **Response**: Alumni from specific graduation year

### Get Alumni Locations
- **Method**: `GET`
- **Endpoint**: `/users/locations`
- **Authentication**: Required
- **Response**: Geographic distribution of alumni

### Get Nearby Alumni
- **Method**: `GET`
- **Endpoint**: `/users/nearby?lat=28.6139&lng=77.2090&radius=10`
- **Authentication**: Required
- **Response**: Alumni nearby given coordinates

---

## Post Routes

### Get Feed
- **Method**: `GET`
- **Endpoint**: `/posts?page=1&limit=20`
- **Authentication**: Optional
- **Response**: List of posts with comments and likes

### Get Post
- **Method**: `GET`
- **Endpoint**: `/posts/:id`
- **Authentication**: Optional
- **Response**: Single post with full details

### Create Post
- **Method**: `POST`
- **Endpoint**: `/posts`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "content": "Post content",
    "media": [],
    "isPrivate": false
  }
  ```

### Upload Media
- **Method**: `POST`
- **Endpoint**: `/posts/media`
- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Files**: Up to 5 media files

### Update Post
- **Method**: `PATCH`
- **Endpoint**: `/posts/:id`
- **Authentication**: Required (owner only)
- **Request Body**: Updated post fields

### Delete Post
- **Method**: `DELETE`
- **Endpoint**: `/posts/:id`
- **Authentication**: Required (owner only)

### Like Post
- **Method**: `POST`
- **Endpoint**: `/posts/:id/like`
- **Authentication**: Required

### Add Comment
- **Method**: `POST`
- **Endpoint**: `/posts/:postId/comments`
- **Authentication**: Required
- **Request Body**: `{ content: "Comment text" }`

### Delete Comment
- **Method**: `DELETE`
- **Endpoint**: `/comments/:id`
- **Authentication**: Required (owner or post owner)

---

## Job Routes

### Get Jobs
- **Method**: `GET`
- **Endpoint**: `/jobs?page=1&limit=20&category=tech`
- **Authentication**: Optional
- **Response**: List of job postings

### Get My Jobs
- **Method**: `GET`
- **Endpoint**: `/jobs/my`
- **Authentication**: Required
- **Response**: Jobs posted by current user

### Get Job
- **Method**: `GET`
- **Endpoint**: `/jobs/:id`
- **Authentication**: Optional
- **Response**: Full job details

### Create Job
- **Method**: `POST`
- **Endpoint**: `/jobs`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "title": "Senior Developer",
    "company": "Tech Corp",
    "description": "We're hiring...",
    "location": "Remote",
    "category": "tech",
    "type": "full-time"
  }
  ```

### Update Job
- **Method**: `PATCH`
- **Endpoint**: `/jobs/:id`
- **Authentication**: Required (owner)

### Delete Job
- **Method**: `DELETE`
- **Endpoint**: `/jobs/:id`
- **Authentication**: Required (owner)

### Approve Job (Admin)
- **Method**: `POST`
- **Endpoint**: `/jobs/:id/approve`
- **Authentication**: Required (admin)

### Reject Job (Admin)
- **Method**: `POST`
- **Endpoint**: `/jobs/:id/reject`
- **Authentication**: Required (admin)

---

## Event Routes

### Get Events
- **Method**: `GET`
- **Endpoint**: `/events?page=1&limit=20`
- **Authentication**: Optional
- **Response**: List of events

### Get Upcoming Events
- **Method**: `GET`
- **Endpoint**: `/events/upcoming`
- **Authentication**: None
- **Response**: Events in future

### Get Event
- **Method**: `GET`
- **Endpoint**: `/events/:id`
- **Authentication**: Optional
- **Response**: Event details

### Get Event Attendees
- **Method**: `GET`
- **Endpoint**: `/events/:id/attendees`
- **Authentication**: Required
- **Response**: List of attendees

### Create Event (Admin)
- **Method**: `POST`
- **Endpoint**: `/events`
- **Authentication**: Required (admin)
- **Request Body**:
  ```json
  {
    "title": "Alumni Meet",
    "description": "Annual alumni gathering",
    "startDate": "2026-05-15T18:00:00Z",
    "endDate": "2026-05-15T20:00:00Z",
    "location": "New Delhi",
    "capacity": 100
  }
  ```

### Update Event
- **Method**: `PATCH`
- **Endpoint**: `/events/:id`
- **Authentication**: Required (organizer)

### Delete Event
- **Method**: `DELETE`
- **Endpoint**: `/events/:id`
- **Authentication**: Required (organizer)

### RSVP Event
- **Method**: `POST`
- **Endpoint**: `/events/:id/rsvp`
- **Authentication**: Required
- **Request Body**: `{ status: "attending" | "maybe" | "not_attending" }`

---

## Message Routes

### Get Conversations
- **Method**: `GET`
- **Endpoint**: `/messages`
- **Authentication**: Required
- **Response**: List of conversations

### Get Unread Count
- **Method**: `GET`
- **Endpoint**: `/messages/unread`
- **Authentication**: Required

### Get Messages
- **Method**: `GET`
- **Endpoint**: `/messages/:partnerId`
- **Authentication**: Required
- **Response**: Messages with specific user

### Send Message
- **Method**: `POST`
- **Endpoint**: `/messages/:receiverId`
- **Authentication**: Required
- **Request Body**: `{ content: "Message text" }`

### Mark as Read
- **Method**: `POST`
- **Endpoint**: `/messages/:partnerId/read`
- **Authentication**: Required

---

## Network Routes

### Get Connections
- **Method**: `GET`
- **Endpoint**: `/network/connections`
- **Authentication**: Required
- **Response**: User's connections

### Get Pending Requests
- **Method**: `GET`
- **Endpoint**: `/network/requests`
- **Authentication**: Required
- **Response**: Pending connection requests

### Get Suggestions
- **Method**: `GET`
- **Endpoint**: `/network/suggestions`
- **Authentication**: Required
- **Response**: Suggested connections

### Send Request
- **Method**: `POST`
- **Endpoint**: `/network/request/:userId`
- **Authentication**: Required

### Respond to Request
- **Method**: `POST`
- **Endpoint**: `/network/respond/:id`
- **Authentication**: Required
- **Request Body**: `{ action: "accept" | "reject" }`

### Remove Connection
- **Method**: `DELETE`
- **Endpoint**: `/network/connection/:id`
- **Authentication**: Required

---

## Notification Routes

### Get Notifications
- **Method**: `GET`
- **Endpoint**: `/notifications`
- **Authentication**: Required
- **Response**: User notifications

### Get Unread Count
- **Method**: `GET`
- **Endpoint**: `/notifications/unread`
- **Authentication**: Required

### Mark as Read
- **Method**: `POST`
- **Endpoint**: `/notifications/:id/read`
- **Authentication**: Required

### Mark All as Read
- **Method**: `POST`
- **Endpoint**: `/notifications/read-all`
- **Authentication**: Required

### Delete Notification
- **Method**: `DELETE`
- **Endpoint**: `/notifications/:id`
- **Authentication**: Required

---

## Donation Routes

### Get Donors Wall
- **Method**: `GET`
- **Endpoint**: `/donations/wall`
- **Response**: Public donors list

### Get Featured Donors
- **Method**: `GET`
- **Endpoint**: `/donations/featured`
- **Response**: Top donors

### Get Donation Stats
- **Method**: `GET`
- **Endpoint**: `/donations/stats`
- **Response**: Donation statistics

### Get Leaderboard
- **Method**: `GET`
- **Endpoint**: `/donations/leaderboard`
- **Response**: Top donors ranking

### Get My Donations
- **Method**: `GET`
- **Endpoint**: `/donations/my`
- **Authentication**: Required
- **Response**: User's donation history

### Create Donation Order
- **Method**: `POST`
- **Endpoint**: `/donations/order`
- **Authentication**: Optional
- **Request Body**:
  ```json
  {
    "amount": 1000,
    "currency": "INR",
    "message": "Supporting the cause"
  }
  ```

### Verify Payment
- **Method**: `POST`
- **Endpoint**: `/donations/verify`
- **Authentication**: Optional
- **Request Body**: Payment verification data

---

## Membership Routes

### Get Membership Tiers
- **Method**: `GET`
- **Endpoint**: `/memberships/tiers`
- **Response**: Available membership tiers

### Get My Membership
- **Method**: `GET`
- **Endpoint**: `/memberships/my`
- **Authentication**: Required
- **Response**: Current membership details

### Create Membership Order
- **Method**: `POST`
- **Endpoint**: `/memberships/order`
- **Authentication**: Required
- **Request Body**: `{ tierId: "premium" }`

### Verify Membership Payment
- **Method**: `POST`
- **Endpoint**: `/memberships/verify`
- **Authentication**: Required
- **Request Body**: Payment verification

---

## Mentorship Routes

### Get Mentors
- **Method**: `GET`
- **Endpoint**: `/mentorship/mentors`
- **Authentication**: Required
- **Response**: Available mentors

### Get My Mentor Profile
- **Method**: `GET`
- **Endpoint**: `/mentorship/profile`
- **Authentication**: Required

### Create Mentor Profile
- **Method**: `POST`
- **Endpoint**: `/mentorship/profile`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "expertise": ["JavaScript", "React"],
    "bio": "Mentor bio",
    "availability": "weekends"
  }
  ```

### Update Mentor Profile
- **Method**: `PATCH`
- **Endpoint**: `/mentorship/profile`
- **Authentication**: Required

### Request Mentorship
- **Method**: `POST`
- **Endpoint**: `/mentorship/request/:mentorId`
- **Authentication**: Required
- **Request Body**: `{ message: "Mentorship request message" }`

### Respond to Request
- **Method**: `POST`
- **Endpoint**: `/mentorship/request/:requestId/respond`
- **Authentication**: Required
- **Request Body**: `{ action: "accept" | "reject" }`

### Schedule Session
- **Method**: `POST`
- **Endpoint**: `/mentorship/request/:requestId/sessions`
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "scheduledAt": "2026-05-15T18:00:00Z",
    "duration": 60,
    "topic": "Session topic"
  }
  ```

### Complete Session
- **Method**: `POST`
- **Endpoint**: `/mentorship/sessions/:sessionId/complete`
- **Authentication**: Required
- **Request Body**: `{ feedback: "Session feedback" }`

---

## Gallery Routes

### Get Albums
- **Method**: `GET`
- **Endpoint**: `/gallery/albums`
- **Response**: Public gallery albums

### Get Album
- **Method**: `GET`
- **Endpoint**: `/gallery/albums/:id`
- **Response**: Album details with photos

### Get Recent Photos
- **Method**: `GET`
- **Endpoint**: `/gallery/recent`
- **Response**: Recently uploaded photos

### Create Album (Admin)
- **Method**: `POST`
- **Endpoint**: `/gallery/albums`
- **Authentication**: Required (admin)

### User Add Photo
- **Method**: `POST`
- **Endpoint**: `/gallery/albums/:albumId/photos`
- **Authentication**: Required
- **Content-Type**: `multipart/form-data`
- **Files**: Up to 10 photos

### Delete User Photo
- **Method**: `DELETE`
- **Endpoint**: `/gallery/photos/:id`
- **Authentication**: Required

---

## News Routes

### Get Articles
- **Method**: `GET`
- **Endpoint**: `/news?page=1&limit=20`
- **Response**: News articles

### Get Latest News
- **Method**: `GET`
- **Endpoint**: `/news/latest`
- **Response**: Recent news

### Get Article
- **Method**: `GET`
- **Endpoint**: `/news/:slug`
- **Response**: Full article content

### Create Article (Admin)
- **Method**: `POST`
- **Endpoint**: `/news`
- **Authentication**: Required (admin)

### Update Article (Admin)
- **Method**: `PATCH`
- **Endpoint**: `/news/:id`
- **Authentication**: Required (admin)

### Publish Article (Admin)
- **Method**: `POST`
- **Endpoint**: `/news/:id/publish`
- **Authentication**: Required (admin)

---

## Health Check

### System Health
- **Method**: `GET`
- **Endpoint**: `/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "database": "mysql",
    "databaseStatus": "up",
    "timestamp": "2026-04-30T02:42:52Z"
  }
  ```

---

## Rate Limiting

- **General API**: 100 requests per 15 minutes per IP
- **Auth Endpoints**: 10 requests per 15 minutes per IP
- **Status**: Returns 429 when limit exceeded

---

## Error Responses

All endpoints return error responses in this format:

```json
{
  "success": false,
  "error": "Error message",
  "statusCode": 400
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Authentication Header

Include JWT token in request headers:
```
Authorization: Bearer <your_jwt_token>
```

---

## Total API Routes: 80+

- Authentication: 15 routes
- Users: 15 routes
- Posts: 8 routes
- Jobs: 8 routes
- Events: 8 routes
- Messages: 6 routes
- Network: 6 routes
- Notifications: 5 routes
- Donations: 6 routes
- Memberships: 5 routes
- Mentorship: 8 routes
- Gallery: 8 routes
- News: 7 routes
- Chapters: 7 routes
- Marketplace: 6 routes
- Admin & Audit: 5 routes
- Health Check: 1 route
