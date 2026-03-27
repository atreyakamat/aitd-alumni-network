1. Document Overview
This Design Document specifies the system architecture, module decomposition, data design, and UI/UX guidelines for the Alumni Connect platform, based on the approved PRD v1.0. It is intended for engineers, designers, and stakeholders as the authoritative reference for how the platform will be built and experienced.
​

2. Visual & Brand Design
2.1 Brand Positioning
Professional, trustworthy, institution-first, alumni-centric.
​

Tone similar to LinkedIn and modern university portals: modern, minimal, content-first.
​

2.2 Color System (LinkedIn-inspired)
Primary:

Primary Blue: #0A66C2 (main actions: primary buttons, links) – LinkedIn-style tone.

Dark Blue: #004182 (hover states, emphasis backgrounds).

Neutrals:

Background: #F3F2EF (app background, feed background).

Surface White: #FFFFFF (cards, panels, modals).

Border Gray: #E0E0E0 (dividers, card borders).

Text Primary: #1E1E1E.

Text Secondary: #5E5E5E.

Semantic:

Success: #0B874B (success badges, payment success).

Warning: #F9A825 (expiring membership, deadlines).

Error: #D32F2F (validation errors, failed payments).

All colors must maintain AA contrast for body text over backgrounds.
​

2.3 Typography
Primary Typeface: System stack or similar to LinkedIn:

Web: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif.

Hierarchy:

H1: 32px / semi-bold, used sparingly on landing and module headers.

H2: 24px / semi-bold, for page subsections.

H3: 20px / medium, for cards and panel headers.

Body: 14–16px / regular.

Caption: 12–13px / regular, for meta info (dates, tags).

Consistent line-height (1.4–1.6) for readability across desktop and mobile.
​

2.4 Components & Layout
Layout grid: 12-column grid, 1200px max content width on desktop, 16px padding on mobile.
​

Core components:

App Shell: top nav bar, left-side navigation (for authenticated users), right-side utility panel (notifications, profile, quick stats).
​

Cards: used for profiles, posts, events, jobs, chapters; elevation via subtle shadow + border.
​

Buttons:

Primary: solid primary blue, white text.

Secondary: white with primary blue border and text.

Tertiary: text-only links.

Forms: stacked labels, clear validation messaging, inline hints.
​

3. High-Level Architecture
3.1 Architectural Style
Client-server with a decoupled SPA/SSR frontend and RESTful backend.
​

API-first: all features exposed via authenticated REST APIs with future GraphQL compatibility.
​

3.2 Logical Layers
Presentation Layer: Next.js (React) web app, SSR for public pages, SPA for authenticated area.
​

Application Layer: Node.js backend (NestJS/Express) implementing business logic, auth, and integrations.
​

Data Layer: PostgreSQL for relational entities, Redis for caching sessions, feed counters, and rate-limiting.
​

Integration Layer: Razorpay, SendGrid/AWS SES, Google Maps, OAuth (Google, LinkedIn), Google Drive.
​

3.3 Deployment Topology
Frontend: Deployed on Vercel (or equivalent) with global edge caching for public routes.
​

Backend: Deployed on AWS/Railway as a stateless service behind a load balancer.
​

Database: Managed PostgreSQL instance (AWS RDS/Railway).
​

Cache: Managed Redis instance.
​

Storage: AWS S3/Cloudflare R2 for all media (avatars, gallery, documents).
​

All services exposed exclusively via HTTPS with TLS 1.2+ termination at the load balancer.
​

4. Module Decomposition
4.1 Public Landing & Marketing Layer
Hero: institutional branding, statistics, Join/Login CTAs, rotating notable alumni.
​

Sections: Upcoming events, recent gallery photos, alumni updates/news, career highlights, notable alumni.
​

Navigation: top-level nav to Events, Gallery, News, Careers, Donations, Services.
​

4.2 Authentication & Onboarding
Registration: email/password, batch/year, department, role, alumni verification workflow.
​

Login: email + password, optional 2FA (email OTP or authenticator).
​

Onboarding wizard: up to 5 steps for profile, education, work, skills, location, and membership prompt.
​

4.3 Core Member Profile
Profile page: header with avatar, cover, name, batch, department, designation, membership badge.
​

Sections: summary/bio, work experience, education, skills, contact/social links, chapters, marketplace listings.
​

Profile completeness bar driven by required fields and key optional data.
​

4.4 Networking & Social
Notice Board: LinkedIn-style feed with post types (general, job, business, announcements).
​

My Network: connections, suggestions, pending requests, remove/accept actions.
​

Messaging: 1:1 messaging, message requests, basic attachments, read receipts.
​

4.5 Alumni Discovery
Yearbook: batch + department filter, grid of alumni cards.
​

Directory: advanced filter panel (role, year, city, company, industry, skills, chapter).
​

Alumni Nearby: world map, clustered pins, mini profile overlays with connect/message.
​

4.6 Careers & Mentorship
Jobs & Opportunities: list and detail views, filters by type, location, industry, skills, experience.
​

Mentorship: mentor profiles, focus areas, availability, request flow, session tracking.
​

4.7 Events, Gallery, News
Events: listing, detail, RSVP, attendee lists, post-event gallery linking.
​

Gallery: albums by type (event, batch, institutional), masonry layout, lightbox.
​

News & Stories: rich articles with categories, featured image, reading time, social share.
​

4.8 Memberships, Donations, Marketplace
Memberships: tier listing, purchase/renew, Razorpay integration, receipts, badges.
​

Donations: donation landing, flow, donors wall, chapter-level stats.
​

Marketplace: listings (business, services, requirements), category filters, contact actions.
​

4.9 Admin Panel
Dashboard: key stats and charts (users, revenue, engagement).
​

User & content management, membership config, job moderation, donations, chapters, analytics & reports.
​

5. Data Design
5.1 Key Entities
The PRD already defines the main entities; these are used as the canonical schema.
​

Core examples (simplified):

User: id, full_name, email, password_hash, batch_year, department, degree, role_type, membership_tier_id, city, hometown, location_lat/lng, is_location_public, linkedin_url, phone_number, is_active, created_at.
​

MembershipTier & UserMembership: define tier configuration and per-user membership history.
​

Post, JobOpportunity, Event, EventRSVP, GalleryAlbum, GalleryPhoto, NewsArticle, Donation, Chapter, MarketplaceListing, Message, Connection, Notification, Transaction.
​

5.2 Relationships
User–MembershipTier: many-to-one via membership_tier_id.
​

User–UserMembership: one-to-many, time-bounded memberships.
​

User–Post: one-to-many, user_id owner.
​

User–Connection: bidirectional via requester_id/addressee_id, with status (pending, accepted, rejected).
​

Event–EventRSVP: one-to-many.
​

Chapter–User: many-to-many via membership table or chapter_membership.
​

5.3 Indexing & Search
Define indexes on email, batch_year, department, city, skills (GIN/JSONB), and text search vectors for names and titles.
​

Use PostgreSQL FTS or Elasticsearch for directory and job search as per PRD.
​

6. Application Design
6.1 Backend Services
Service grouping (NestJS modules / Express routers):

AuthService, UserService, ProfileService.

FeedService (posts, interactions, moderation).

DirectoryService (search and filters).

CareersService, MentorshipService.

EventsService, GalleryService, NewsService.

MembershipService, BillingService (Razorpay), DonationService.

ChapterService, MarketplaceService.

MessagingService, NetworkService, NotificationService.

AdminService, ReportingService.

Each service exposes REST endpoints secured via JWT & RBAC middleware.
​

6.2 Authentication & Authorization
JWT access tokens with 24h expiry and refresh token rotation, with secure cookie or header-based storage.
​

Role-based access control: Guest, Member, Paid Member, Admin, Super Admin enforced at controller level.
​

6.3 Non-Functional Design
Performance targets:

Page load < 2s for 95th percentile (desktop).
​

API response < 500 ms for standard queries.
​

Scalability: support 1,000 concurrent users initially, scalable to 10,000 via horizontal scaling.
​

Availability: 99.5% uptime per month.
​

6.4 Security & Privacy
bcrypt password hashing (cost factor 12+).
​

HTTPS everywhere, CSRF protection, input sanitization, parameterized queries, rate limiting on auth endpoints.
​

RBAC in API, encrypted phone and sensitive fields at rest, audit trail for admin actions.
​

City-level only location, explicit consent, deletable on demand, GDPR-aligned export/delete.
​

7. UX Flows (Examples)
7.1 Registration & Onboarding Flow
Visitor clicks “Join Now” on landing → registration page.
​

Submit details → email verification → login.
​

On first login, onboarding wizard: profile details, work, education, skills, location consent, membership prompt.
​

Completion leads to personalized home feed.
​

7.2 Posting a Job
From Careers → “Post Opportunity” → form with structured fields.
​

Save draft or publish; if moderation required, status “Pending Review”.
​

On approval, listing appears in jobs feed and triggers notifications to relevant users.
​

8. UI Structure by Role
8.1 Public Visitor
Accessible: Landing, Events (public), Gallery, News & Stories, Donations.
​

Prominent calls-to-action: Join, Login, Donate.
​

8.2 Registered Member (Free)
Full social feed, profiles, directory, events, messaging (with reasonable limits), careers, chapters, basic marketplace.
​

8.3 Paid Member
All of the above plus priority visibility in directory and marketplace, exclusive events, and priority job listings as per tier config.
​

8.4 Admin & Super Admin
Dedicated admin panel with navigation to users, content, memberships, jobs, donations, chapters, reports, and system configuration.
​

9. Implementation Notes (High-Level)
Frontend:

Next.js app with file-based routing, ISR/SSR for public content, client-side routing for app area.
​

Tailwind CSS + shadcn/ui for components, theme configured with the color system above.
​

Backend:

Node.js + NestJS (or Express with modular structure) with PostgreSQL via ORM (Prisma/TypeORM).
​

Centralized error handling and logging, structured logs for monitoring.