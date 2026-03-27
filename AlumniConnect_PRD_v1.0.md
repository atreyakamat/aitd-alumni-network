**ALUMNI CONNECT**

College Alumni Network Platform

**Product Requirements Document (PRD)**

Version 1.0 \| Confidential

Prepared for: Alumni Network Platform Project Team

Date: 27 March 2026

**Document Control**

**Revision History**

  --------------------------------------------------------------------------
  **Version**   **Date**        **Author**         **Description**
  ------------- --------------- ------------------ -------------------------
  1.0           27/3/2026       Project Team       Initial PRD draft ---
                                                   full platform scope

  --------------------------------------------------------------------------

**Document Purpose**

This Product Requirements Document (PRD) defines the full scope,
features, functional requirements, and technical specifications for the
Alumni Connect platform --- a comprehensive digital ecosystem for
engineering college alumni. It is intended to align stakeholders, guide
the development team, and serve as the single source of truth throughout
the project lifecycle.

**Table of Contents**

**1. Executive Summary**

2\. Project Overview

3\. Goals & Success Metrics

4\. User Personas

5\. System Architecture Overview

6\. Feature Modules --- Detailed Requirements

6.1 Public Landing Page

6.2 Authentication & Onboarding

6.3 User Profile

6.4 Membership & Subscriptions

6.5 Notice Board (Social Feed)

6.6 Find Alumni --- Yearbook

6.7 Find Alumni --- Alumni Directory

6.8 Find Alumni --- Invite Batchmates

6.9 Find Alumni --- Alumni Nearby (Map)

6.10 Careers --- Jobs, Internships & Mentorship

6.11 Events & RSVP

6.12 Gallery

6.13 News & Stories

6.14 Donations

6.15 Chapters

6.16 Alumni Marketplace

6.17 Messaging

6.18 My Network

6.19 Notifications

6.20 Transactions & Billing

6.21 Admin Panel

7\. Advanced / Future Enhancements

8\. Non-Functional Requirements

9\. Technology Stack Recommendations

10\. Data Models & Key Entities

11\. Security & Privacy

12\. Integrations

13\. Glossary

**1. Executive Summary**

Alumni Connect is a full-featured, web-based alumni network platform
designed specifically for engineering colleges. It aims to bridge the
gap between current students, recent graduates, and seasoned alumni by
providing an integrated suite of networking, career, and community tools
--- all under a single, institution-branded platform.

The platform will serve three primary groups: unauthenticated public
visitors who can browse events, news, and notable alumni; registered
alumni and students who access the full social and professional
networking suite; and platform administrators who manage content,
memberships, and user data.

Alumni Connect directly competes with --- and significantly improves
upon --- existing alumni platforms by incorporating real-time geospatial
alumni mapping, AI-powered mentorship matching, advanced career
filtering, multi-tier paid memberships, a live social feed, and an
alumni services marketplace.

**2. Project Overview**

**2.1 Background**

The institution currently has an existing alumni network platform.
Alumni Connect is designed to replicate and significantly surpass its
functionality, delivering a more modern, dynamic, and scalable
experience. The platform will act as the primary digital home for the
institution\'s alumni community --- spanning all graduating batches,
departments, and geographies.

**2.2 Platform Scope**

-   Public-facing marketing and information layer (no login required)

-   Authenticated member portal with full social and professional
    networking

-   Comprehensive administrative control panel

-   Payment and subscription management for membership tiers

-   Geospatial alumni mapping with world-level aggregation

-   Career ecosystem: jobs, internships, mentorships, volunteer roles

-   Content management: news, events, stories, galleries

-   Alumni marketplace for business listings and service offerings

**2.3 Key Stakeholders**

  -------------------------------------------------------------------------
  **Stakeholder**   **Role**        **Interest**
  ----------------- --------------- ---------------------------------------
  College           Owner / Sponsor Institutional branding, alumni
  Administration                    engagement, donations

  Alumni            Primary Users   Networking, career growth, staying
                                    connected

  Current Students  Secondary Users Mentorship, internships, placements

  Platform Admins   Operators       Content management, memberships,
                                    moderation

  Donors            Contributors    Transparent donation tracking,
                                    recognition

  Businesses /      Marketplace     Reach alumni for services and hiring
  Startups          Users           
  -------------------------------------------------------------------------

**3. Goals & Success Metrics**

**3.1 Primary Goals**

1.  Build a comprehensive, scalable alumni network platform that
    surpasses the existing solution.

2.  Increase alumni engagement through meaningful networking, career,
    and community features.

3.  Generate sustainable revenue via tiered memberships and donations.

4.  Provide the institution with actionable insights about its alumni
    community.

5.  Foster strong cross-batch and cross-geography connections among
    alumni.

**3.2 Key Performance Indicators (KPIs)**

  -----------------------------------------------------------------------
  **KPI**                **Target (Year     **Measurement Method**
                         1)**               
  ---------------------- ------------------ -----------------------------
  Registered Alumni      40% of all         User database count
                         graduates          

  Monthly Active Users   25% of registered  Login & activity events
                         users              

  Membership Conversion  10% of registered  Paid subscription count
  Rate                   users              

  Job/Internship         100+               Career module post count
  Postings               listings/month     

  Events Created         10+ events/month   Events module tracking

  Donation Volume        ₹5,00,000 / year   Payment gateway records

  Profile Completion     70% of registered  Profile completeness score
  Rate                   users              

  Alumni Nearby Map      60% of users share Location consent approvals
  Active Pins            location           
  -----------------------------------------------------------------------

**4. User Personas**

**Persona 1: The Recent Graduate (Alumni)**

  -----------------------------------------------------------------------
  **Attribute**      **Detail**
  ------------------ ----------------------------------------------------
  Name               Rohan Mehta

  Age                23

  Batch              2024, Computer Engineering

  Goals              Find internships, connect with seniors, build a
                     professional network

  Pain Points        Doesn\'t know where seniors ended up, no structured
                     way to reach them

  Key Features Used  Directory, Notice Board, Careers, Messaging, Profile
  -----------------------------------------------------------------------

**Persona 2: The Senior Alumni (Mentor)**

  -----------------------------------------------------------------------
  **Attribute**      **Detail**
  ------------------ ----------------------------------------------------
  Name               Priya Nair

  Age                38

  Batch              2010, Electronics Engineering

  Goals              Give back to college, mentor juniors, post job
                     openings from her company

  Pain Points        No easy channel to reach motivated juniors at scale

  Key Features Used  Mentorship, Career postings, Notice Board, Chapters,
                     Donations
  -----------------------------------------------------------------------

**Persona 3: The Platform Administrator**

  -----------------------------------------------------------------------
  **Attribute**      **Detail**
  ------------------ ----------------------------------------------------
  Name               Admin Team

  Role               College alumni cell staff

  Goals              Moderate content, manage memberships, publish events
                     and news, track donations

  Pain Points        Needs an easy-to-use CMS without relying on
                     developers for every change

  Key Features Used  Admin Panel --- all modules
  -----------------------------------------------------------------------

**Persona 4: The Public Visitor**

  -----------------------------------------------------------------------
  **Attribute**      **Detail**
  ------------------ ----------------------------------------------------
  Name               Various

  Role               Prospective student, parent, or corporate visitor

  Goals              Learn about the institution\'s alumni and events

  Key Features Used  Landing page, Events, Gallery, News & Stories
  -----------------------------------------------------------------------

**5. System Architecture Overview**

**5.1 High-Level Architecture**

Alumni Connect follows a client-server architecture with a decoupled
frontend and backend, communicating via RESTful APIs (or GraphQL). The
system is composed of the following primary layers:

-   Frontend (Web Application): React.js (or Next.js) SPA/SSR app served
    via CDN

-   Backend API Server: Node.js / Django REST framework handling
    business logic

-   Database: PostgreSQL (relational data) + Redis (caching/sessions)

-   File Storage: AWS S3 / Cloudflare R2 for images, gallery media,
    documents

-   Maps Service: Google Maps API / Mapbox for Alumni Nearby feature

-   Payment Gateway: Razorpay (India-first, supports INR, UPI, cards)

-   Email Service: SendGrid / AWS SES for transactional and invite
    emails

-   Search: Elasticsearch or PostgreSQL full-text search for directory
    and jobs

-   Authentication: JWT-based with optional Google / LinkedIn OAuth

**5.2 User Access Levels**

  ------------------------------------------------------------------------
  **Role**        **Access Level** **Description**
  --------------- ---------------- ---------------------------------------
  Guest / Public  L0 --- Read Only Landing page, public events, gallery,
                                   news --- no login required

  Registered      L1 --- Full      All networking, social, career, and
  Member          Member           profile features

  Paid Member     L2 --- Premium   All L1 features plus exclusive
                                   membership benefits

  Admin           L3 --- Full      All features plus admin panel, content
                  Control          management, user management

  Super Admin     L4 --- Root      All L3 plus system configuration, role
                                   management
  ------------------------------------------------------------------------

**6. Feature Modules --- Detailed Requirements**

**6.1 Public Landing Page**

The landing page is the primary entry point for all visitors and must
project a professional, welcoming, and engaging image of the
institution\'s alumni network. It is fully accessible without login.

**6.1.1 Hero Section**

-   Full-width banner with institutional branding, tagline, and
    call-to-action buttons (Join Now / Login)

-   Rotating or animated showcase of notable alumni with photos, names,
    and designations

-   Live statistics: Total Alumni Registered, Companies, Countries,
    Batches

**6.1.2 Featured Sections (No Login Required)**

-   Upcoming Events --- cards showing next 3--5 events with date, type,
    and RSVP button

-   Recent Gallery Photos --- thumbnail grid linking to full gallery

-   Alumni Updates / News --- latest 3 news/story items

-   Career Opportunities --- preview of recent job/internship posts

-   Notable Alumni Spotlight --- curated alumni featured by admin

**6.1.3 Navigation Bar**

-   Logo + Institution Name

-   Links: Events, Gallery, News & Stories, Find Alumni (dropdown),
    Careers (dropdown), Donations, Services

-   Login / Register buttons (right aligned)

**6.1.4 Footer**

-   Institution name, address, contact details, social media links

-   Quick links: About, Membership, Privacy Policy, Terms & Conditions,
    Contact

-   \'Become a Member\' call-to-action panel

**6.2 Authentication & Onboarding**

**6.2.1 Registration**

-   Self-registration form: full name, email, batch year, department,
    degree, current role (student/alumni)

-   Email verification required before access is granted

-   Optional: Social sign-in via Google or LinkedIn

-   Alumni verification workflow: admin can approve or auto-verify by
    batch email domain

**6.2.2 Login**

-   Email + password login

-   \'Forgot Password\' with email-based reset link

-   Optional 2FA (OTP via email or authenticator app)

**6.2.3 Onboarding Wizard**

-   Step-by-step profile completion after first login (up to 5 steps)

-   Progress bar encouraging 100% profile completion

-   Optional location sharing prompt for Alumni Nearby feature

**6.3 User Profile**

**6.3.1 Profile Information**

-   Profile photo and cover photo upload

-   Full name, class year, batch, department, degree (BE/BTech/ME/MTech
    etc.)

-   Current designation / position (e.g., Software Engineer, Student,
    Entrepreneur)

-   Role type: Student or Alumni

-   Short bio / about me section

**6.3.2 Work Experience**

-   Multiple work experience entries: Company, Role, Start Date, End
    Date, Description, Location

-   Current/ongoing employment flag

**6.3.3 Education**

-   Institution-specific entry (auto-populated), plus additional
    educational qualifications

-   Other degrees, certifications, other institutes

**6.3.4 Skills & Expertise**

-   Tag-based skill selection from master list (with custom skill
    addition)

-   Endorsements from other alumni (optional feature)

**6.3.5 Contact Information**

-   Email (primary --- from registration), secondary email

-   Phone number (with visibility controls: public / connections only /
    private)

-   City and Hometown (used for Alumni Nearby and directory search)

-   LinkedIn URL, Twitter/X URL, GitHub URL, Personal Website

**6.3.6 Profile URL**

-   Each profile gets a unique, shareable URL:
    alumni.college.edu/profile/\[username-or-ID\]

**6.3.7 Membership Badge**

-   Membership tier badge displayed on profile (e.g., Patron, Gold,
    General Member)

**6.4 Membership & Subscriptions**

**6.4.1 Membership Tiers (Admin-Configurable)**

All membership tiers, pricing, benefits, and durations are configurable
from the Admin Panel without any code deployment.

  ------------------------------------------------------------------------
  **Tier**         **Example Price  **Duration**   **Key Benefits**
                   (₹)**                           
  ---------------- ---------------- -------------- -----------------------
  General Member   Free             Lifetime       Basic profile,
                                                   directory access,
                                                   notice board, events

  Silver Member    ₹1,000           1 Year         All General + priority
                                                   job listings, exclusive
                                                   events

  Gold Member      ₹4,000           Lifetime       All Silver + featured
                                                   profile, marketplace
                                                   priority listing

  Patron Member    ₹5,000+          Lifetime       All Gold + donor
                                                   recognition, chapter
                                                   voting rights,
                                                   exclusive newsletters
  ------------------------------------------------------------------------

**6.4.2 Membership Management**

-   Members can view, purchase, or renew memberships from their profile
    or a dedicated \'Membership\' page

-   Payment via Razorpay (UPI, credit/debit card, netbanking)

-   Auto-renewal option with email reminders (30, 7, 1 day before
    expiry)

-   Admin can manually assign, upgrade, or revoke memberships

-   Transaction receipts emailed automatically after each purchase

**6.5 Notice Board (Social Feed)**

The Notice Board is the social hub of the platform --- a LinkedIn-style
feed where alumni can share posts, opportunities, and updates.

**6.5.1 Post Types**

-   General Post: text + optional image/link

-   Job Post: structured job opportunity card (company, role, location,
    link, deadline)

-   Business Connect Post: alumni listing a business or service they
    offer

-   Announcement: admin-generated highlights pinned to the top of the
    feed

**6.5.2 Feed Interaction**

-   Like, Comment, Share on posts

-   Follow/unfollow specific people to customize feed

-   Feed algorithm: recent posts from connections + trending public
    posts

**6.5.3 Moderation**

-   Report post / report user functionality

-   Admin review queue for reported content

-   Admin can delete any post or suspend users

**6.6 Find Alumni --- Yearbook**

The Yearbook allows alumni to browse graduates by batch year and
department, recreating the familiar yearbook experience digitally.

-   Step 1: Select a batch year from a year selector (e.g., Class of
    2024, 2023\... all years)

-   Step 2: Select a department (All Departments / Computer Engineering
    / Electronics / Mechanical / Civil / etc.)

-   Step 3: View a grid of alumni profiles from that batch and
    department with photo, name, and designation

-   Click any profile card to view the full profile

-   Search bar within yearbook view for name-level search

**6.7 Find Alumni --- Alumni Directory**

The Alumni Directory provides a comprehensive, filterable database of
all registered alumni.

**6.7.1 Search & Filters**

  -----------------------------------------------------------------------
  **Filter Category**        **Options**
  -------------------------- --------------------------------------------
  Name                       Free-text search

  Role                       Student, Alumni, Faculty

  Year of Graduation         Multi-select year range

  Current City               City picker with autocomplete

  Hometown                   City picker

  Chapter                    Dropdown of available chapters

  Company / Employer         Free-text or dropdown

  Designation                Free-text

  Profession / Industry      Multi-select industry list

  Work Industry              IT, Finance, Healthcare, Manufacturing,
                             Education, etc.

  Skills                     Tag-based multi-select

  Other Institute            Free-text (for alumni who studied elsewhere
                             too)

  Other Degree               Multi-select degree types

  Department                 Multi-select departments
  -----------------------------------------------------------------------

**6.7.2 Results Display**

-   Card view and list view toggle

-   Each card: profile photo, name, batch, department, current
    role/company

-   \'Connect\' and \'Message\' quick-action buttons on each card

-   Pagination with configurable results per page (12 / 24 / 48)

**6.8 Find Alumni --- Invite Batchmates**

Allows registered alumni to invite their batchmates who have not yet
joined the platform.

-   Input fields: Full Name, Email Address, Role (Alumni / Student),
    Batch Year

-   Bulk invite: CSV upload support for inviting many batchmates at once

-   System sends a branded email invitation with a registration link

-   Invite tracking: \'Pending\', \'Accepted\', \'Expired\' status for
    each invite sent

-   Admin can view all invites sent across the platform and
    resend/cancel

**6.9 Find Alumni --- Alumni Nearby (Map View)**

The Alumni Nearby feature renders an interactive world map showing the
geographic distribution of all alumni who have consented to share their
location.

**6.9.1 Map Behaviour**

-   Clustered pins at world level --- zoom in to see city/neighbourhood
    level individual pins

-   Click a cluster to zoom into it and see individual alumni

-   Click an individual pin to see a mini profile card (photo, name,
    batch, company)

-   \'Connect\' and \'Message\' buttons within the mini card

**6.9.2 Privacy & Consent**

-   Users must explicitly opt-in to sharing their location (city-level,
    NOT precise coordinates)

-   Location precision limited to city level for privacy

-   Users can withdraw location consent from their profile settings at
    any time

**6.10 Careers --- Jobs, Internships & Mentorship**

**6.10.1 Opportunity Types**

-   Full-Time Job

-   Part-Time Job

-   Internship

-   Contractual / Freelance

-   Volunteer

-   Mentorship (structured mentorship offering by a senior alumnus)

**6.10.2 Posting an Opportunity (Alumni / Admin)**

-   Title, Description, Company Name, Location (City / Remote / Hybrid),
    Work Type

-   Industry / Domain, Required Skills (tag-based), Experience Required,
    Salary Range (optional)

-   Application deadline, Application link or in-platform application

**6.10.3 Browsing & Filtering**

  -----------------------------------------------------------------------
  **Filter**            **Options**
  --------------------- -------------------------------------------------
  Opportunity Type      Job / Internship / Contractual / Freelance /
                        Volunteer / Mentorship

  Location              City autocomplete, Remote option

  Industry              Multi-select industry list

  Workplace Type        On-site / Remote / Hybrid

  Salary Range          Slider or range input (INR)

  Skills Required       Tag-based multi-select

  Work Experience       Fresher / 1-3 yrs / 3-5 yrs / 5+ yrs

  Posted By             Alumni / Company / Admin
  -----------------------------------------------------------------------

**6.10.4 Mentorship Module**

-   Senior alumni can list themselves as available mentors with focus
    areas, availability, and bio

-   Students/junior alumni can search mentors by domain, industry, and
    skill

-   Request mentorship → mentor receives notification → accept/decline

-   Scheduled session tracking (date, notes, outcomes)

**6.11 Events & RSVP**

**6.11.1 Event Types**

-   Online (webinar, virtual meetup)

-   Offline (physical event: city, venue)

-   Hybrid

**6.11.2 Event Listing Card**

-   Event name, banner image, date/time, type (online/offline), location
    or join link

-   Tags: Networking, Career, Cultural, Reunion, Sports, Alumni Meet,
    etc.

-   RSVP count and capacity (if applicable)

**6.11.3 Event Detail Page**

-   Full event description, agenda, speakers/guests

-   RSVP button (for logged-in users) with confirmation email sent

-   List of who is attending (if admin sets as public)

-   Post-event: summary, photos linking to gallery

**6.11.4 Admin Event Management**

-   Create, edit, delete events

-   Set capacity and waitlist

-   Export attendee list as CSV

-   Send bulk email to RSVPed attendees

**6.12 Gallery**

**6.12.1 Gallery Types**

-   Event Gallery: photos from a specific event (linked to Events
    module)

-   Batch Gallery: graduation photos and memories for a specific
    graduating batch

-   General / Institutional Gallery: college photos, campus, milestones

**6.12.2 Gallery Features**

-   Masonry / grid photo layout with lightbox view

-   Albums organized by year and category

-   Optional: Google Drive folder integration --- sync albums directly
    from a shared Drive folder

-   Admin-only upload capability

-   Photo caption and tag support

**6.13 News & Stories**

**6.13.1 Content Categories**

-   Event Recap: post-event write-ups

-   Alumni Stories: feature articles on successful alumni

-   Institute Updates: official announcements and news from the college

-   Newsletters: periodic digests (PDF or HTML)

**6.13.2 Article Features**

-   Rich text editor for admin (supports images, bold, lists, headings,
    embeds)

-   Featured image, author, publish date, reading time estimate

-   Social sharing buttons (WhatsApp, LinkedIn, Twitter)

-   Related articles suggestion

-   Comment section (optional, admin-configurable)

**6.14 Donations**

**6.14.1 Donation Landing Page (Public)**

-   Why donate: institutional goals, impact areas (scholarships,
    infrastructure, research)

-   How donations are used: transparent breakdown with
    visuals/infographics

**6.14.2 Donation Flow**

-   Select amount (preset options: ₹500, ₹1,000, ₹5,000, ₹10,000 +
    custom amount)

-   Optional: dedicate donation (in memory of / in honour of)

-   Payment via Razorpay

-   Automated receipt emailed post-donation

**6.14.3 Donors Wall**

-   Public list of all donors (with consent), showing name, batch, and
    donation category

-   Anonymous donation option

-   Admin can feature \'Significant Donors\' section

**6.14.4 Chapter-Level Donations**

-   Track donation amounts contributed by each chapter

-   Chapter leaderboard on the donations page

**6.15 Chapters**

Chapters are regional or thematic alumni groups (e.g., Bangalore
Chapter, Mumbai Chapter, North America Chapter).

-   Chapter listing page: name, region, lead contact, member count,
    upcoming events

-   Each chapter has a detail page: events, members, gallery, and
    donation stats

-   Alumni can join/leave chapters from their profile or the chapter
    page

-   Chapter admins (assigned by super admin) can post events and updates
    specific to their chapter

-   \'Alumni Who Attended an Event in This Chapter\' listing

**6.16 Alumni Marketplace**

The Alumni Marketplace is where alumni can list their businesses,
freelance services, or professional requirements --- fostering
intra-alumni commerce and collaboration.

**6.16.1 Listing Types**

-   Business Listing: Name, Category, Description, Location, Website,
    Contact

-   Service Offering: Skill/Service, Rate (optional), Availability

-   Requirement / Collaboration Request: What you need, budget, timeline

**6.16.2 Discovery**

-   Browse by category (IT & Tech, Consulting, Design, Finance, Health,
    Food & Hospitality, etc.)

-   Search by keyword, location, category

-   \'Connect with Seller\' button triggers a direct message

**6.17 Messaging (Direct Messages)**

-   1-to-1 private messaging between connected alumni

-   Message request system for non-connections (to reduce spam)

-   Text, emoji, and file/image attachment support

-   Read receipts and online status indicators

-   Notifications for new messages (in-app and email digest)

-   Admin cannot read private messages (privacy policy compliant)

**6.18 My Network**

-   View all current connections (LinkedIn-style)

-   People you may know: suggestions based on batch, department,
    location, or mutual connections

-   Pending connection requests (sent and received)

-   Withdraw sent request / accept or decline incoming requests

-   Remove connection option

-   Network size counter on profile

**6.19 Notifications**

-   In-app notification bell with unread count badge

-   Notification types: connection request, message received, post
    liked/commented, event RSVP confirmed, membership expiry reminder,
    new job posted matching your profile, admin announcements

-   Email notifications with user-configurable frequency (Instant /
    Daily Digest / Weekly Digest / Off)

-   Push notifications (Phase 2 --- mobile app)

**6.20 Transactions & Billing**

-   \'My Transactions\' page in user profile showing all payments
    (membership, donations)

-   Transaction details: date, amount, type, status (Success / Failed /
    Pending)

-   Download receipt as PDF for each transaction

-   Admin view: full transaction ledger across all users, exportable as
    CSV/Excel

**6.21 Admin Panel**

**6.21.1 Dashboard**

-   Real-time stats: total users, new signups this month, active
    members, revenue this month, pending approvals

-   Charts: user growth over time, membership tier distribution, career
    posts by type

**6.21.2 User Management**

-   View, search, filter all registered users

-   Approve / reject new registrations (if manual verification is on)

-   Assign or change roles: Member, Chapter Admin, Admin

-   Suspend or deactivate accounts

-   Manually upgrade / assign membership tier

**6.21.3 Content Management**

-   Manage all News & Stories: create, edit, publish, unpublish, delete

-   Manage Events: full CRUD, export attendees, send event emails

-   Manage Gallery: create albums, upload photos, link to events

-   Manage Notice Board: pin announcements, moderate reported posts

**6.21.4 Membership Management**

-   Create and edit membership tiers: name, price, duration, benefits
    list

-   Toggle tier availability (active/inactive)

-   View all paid members and their expiry dates

**6.21.5 Career & Jobs Moderation**

-   Review and approve/reject job postings

-   Feature selected opportunities at the top of the listings

**6.21.6 Donation Management**

-   View all donation records

-   Update and verify offline donations (bank transfer, cheque)

-   Feature donors on the donors wall

**6.21.7 Chapter Management**

-   Create, edit, delete chapters

-   Assign chapter admins

-   View chapter-level member and donation stats

**6.21.8 Communication Tools**

-   Bulk email to: all users / specific batch / specific department /
    paid members / custom segment

-   Email template editor with variables ({{name}}, {{batch}}, etc.)

-   Invite management: view all pending invites, resend, cancel

**6.21.9 Analytics & Reports**

-   Downloadable reports: user list, transaction history, RSVP lists,
    donation summary

-   Export formats: CSV, Excel, PDF

**7. Advanced & Future Enhancements**

**7.1 AI-Powered Features (Phase 2)**

-   Smart Mentor Matching: AI recommends mentors based on a student\'s
    stated career goals and the mentor\'s background

-   Job Recommendation Engine: Personalised career opportunity
    suggestions based on profile skills and history

-   Profile Completion AI Assistant: Suggests missing profile
    information and auto-fills work details via LinkedIn import

**7.2 Mobile Application (Phase 2)**

-   Native iOS and Android apps with push notifications

-   Alumni Nearby with live location (opt-in)

-   Mobile-first event RSVP and check-in via QR code

**7.3 Enhanced Social Features**

-   Alumni video testimonials / success story short videos

-   Community Groups: interest-based groups (e.g., \'Machine Learning
    Enthusiasts\', \'Entrepreneurs Club\')

-   Alumni Polls and Surveys

**7.4 Platform Integrations**

-   LinkedIn OAuth for single-click profile import and network
    cross-posting

-   Google Calendar integration for event reminders

-   WhatsApp Business API for OTP, event reminders, and invites

-   Zoom / Google Meet integration for creating online event links
    directly from the events module

**7.5 Gamification**

-   Profile completion score with milestone rewards

-   \'Top Contributor\' badges for most active notice board users

-   Chapter activity leaderboards

**8. Non-Functional Requirements**

  -----------------------------------------------------------------------
  **Category**     **Requirement**        **Target**
  ---------------- ---------------------- -------------------------------
  Performance      Page load time         \< 2 seconds for 95th
                   (desktop)              percentile

  Performance      API response time      \< 500ms for standard queries

  Scalability      Concurrent users       1,000 concurrent users at
                   supported              launch; scalable to 10,000

  Availability     System uptime SLA      99.5% monthly uptime

  Security         Data in transit        HTTPS/TLS 1.2+ enforced across
                                          all endpoints

  Security         Data at rest           AES-256 encryption for
                                          sensitive fields

  Security         Authentication         JWT with 24hr expiry + refresh
                                          token rotation

  Privacy          Location data          City-level only, explicit
                                          consent required, deleteable

  Accessibility    WCAG compliance        WCAG 2.1 Level AA

  Browser Support  Minimum support        Chrome 90+, Firefox 88+, Safari
                                          14+, Edge 90+

  Mobile           Breakpoints            Fully responsive: 360px --
  Responsiveness                          1920px screen widths

  Backup           Database backups       Daily automated backups, 30-day
                                          retention
  -----------------------------------------------------------------------

**9. Technology Stack Recommendations**

  ------------------------------------------------------------------------
  **Layer**       **Recommended         **Rationale**
                  Technology**          
  --------------- --------------------- ----------------------------------
  Frontend        Next.js (React)       SSR for SEO on public pages, fast
                                        SPA for logged-in experience

  Styling         Tailwind CSS +        Rapid, consistent UI development
                  shadcn/ui             with accessible components

  Backend         Node.js + Express /   JavaScript full-stack, large
                  NestJS                ecosystem, REST + WebSocket
                                        support

  Database        PostgreSQL            Relational integrity for alumni
                                        data, strong query support

  Cache           Redis                 Session storage, API response
                                        caching, real-time feed counters

  Search          PostgreSQL FTS /      Alumni directory and job search
                  Elasticsearch         with filters

  File Storage    AWS S3 / Cloudflare   Scalable media storage for
                  R2                    gallery, profile photos

  Maps            Google Maps           Clustering, geocoding, worldwide
                  JavaScript API        coverage

  Payments        Razorpay              India-first, supports INR, UPI,
                                        all major cards, webhooks

  Email           SendGrid / AWS SES    Transactional emails, templates,
                                        delivery analytics

  Auth            JWT + Passport.js /   Flexible, supports OAuth (Google,
                  NextAuth              LinkedIn)

  Deployment      AWS / Vercel +        Scalable cloud with managed DB
                  Railway               options

  CI/CD           GitHub Actions        Automated testing and deployment
                                        pipelines
  ------------------------------------------------------------------------

**10. Data Models & Key Entities**

**10.1 User**

  -------------------------------------------------------------------------
  **Field**            **Type**         **Notes**
  -------------------- ---------------- -----------------------------------
  id                   UUID             Primary key

  full_name            VARCHAR          

  email                VARCHAR UNIQUE   Login identifier

  password_hash        VARCHAR          bcrypt hashed

  batch_year           INTEGER          Graduation year

  department           VARCHAR          Engineering department

  degree               VARCHAR          BE / BTech / ME etc.

  role_type            ENUM             \'student\' \| \'alumni\' \|
                                        \'admin\'

  membership_tier_id   FK →             
                       MembershipTier   

  profile_photo_url    VARCHAR          

  city                 VARCHAR          Current city

  hometown             VARCHAR          

  location_lat         DECIMAL          City-level (opt-in)

  location_lng         DECIMAL          City-level (opt-in)

  is_location_public   BOOLEAN          Default false

  linkedin_url         VARCHAR          

  phone_number         VARCHAR          Encrypted

  is_active            BOOLEAN          Account status

  created_at           TIMESTAMP        
  -------------------------------------------------------------------------

**10.2 Other Key Entities**

  -----------------------------------------------------------------------
  **Entity**             **Key Fields**
  ---------------------- ------------------------------------------------
  MembershipTier         id, name, price_inr, duration_months,
                         benefits_json, is_active

  UserMembership         id, user_id, tier_id, start_date, end_date,
                         payment_id, status

  Post (Notice Board)    id, user_id, type, content, media_url,
                         is_pinned, created_at

  JobOpportunity         id, posted_by, title, type, company, location,
                         work_type, salary_range, skills_json, deadline,
                         status

  Event                  id, title, type, date, venue_or_link, capacity,
                         rsvp_count, status, created_by

  EventRSVP              id, event_id, user_id, rsvp_at

  GalleryAlbum           id, title, type, batch_year, event_id,
                         cover_photo_url

  GalleryPhoto           id, album_id, url, caption, uploaded_by

  NewsArticle            id, title, category, content, featured_image,
                         author_id, published_at, status

  Donation               id, user_id, amount, is_anonymous, payment_id,
                         dedicated_to, created_at

  Chapter                id, name, region, admin_user_id, member_count,
                         total_donations

  MarketplaceListing     id, user_id, type, title, category, description,
                         location, contact_info

  Message                id, sender_id, receiver_id, content, media_url,
                         is_read, sent_at

  Connection             id, requester_id, addressee_id, status,
                         created_at

  Notification           id, user_id, type, message, link, is_read,
                         created_at

  Transaction            id, user_id, type, amount, gateway_id, status,
                         created_at
  -----------------------------------------------------------------------

**11. Security & Privacy**

-   All passwords hashed with bcrypt (cost factor 12+)

-   HTTPS enforced everywhere --- no HTTP fallback

-   JWT tokens with short expiry and secure refresh token rotation

-   Input sanitisation and parameterised queries to prevent SQL
    injection

-   CSRF protection on all state-changing API endpoints

-   Rate limiting on auth endpoints (login, register, forgot password)
    to prevent brute force

-   Role-based access control (RBAC) enforced at the API layer

-   Phone numbers and sensitive contact fields stored encrypted at rest

-   Location data: city-level only, explicit consent required,
    deleteable on demand

-   GDPR-aligned data handling: users can request data export or full
    account deletion

-   Admin actions logged in an audit trail (who changed what, when)

-   Private messages end-to-end accessible only to participants --- no
    admin read access

-   Privacy Policy and Terms of Service pages linked from all pages

**12. Integrations**

  ------------------------------------------------------------------------
  **Integration**       **Purpose**                    **Priority**
  --------------------- ------------------------------ -------------------
  Razorpay              Membership payments, donations P0 --- Required at
                                                       launch

  SendGrid / AWS SES    Transactional emails, invites, P0 --- Required at
                        digests                        launch

  Google Maps API       Alumni Nearby map, geocoding   P0 --- Required at
                                                       launch

  Google OAuth          Social login                   P1 --- Phase 1

  LinkedIn OAuth        Social login + profile import  P1 --- Phase 1

  Google Drive API      Gallery album sync from Drive  P1 --- Phase 1
                        folders                        

  Zoom / Google Meet    Auto-generate event links      P2 --- Phase 2
  API                                                  

  WhatsApp Business API OTP, reminders, invites        P2 --- Phase 2

  Firebase / OneSignal  Push notifications (mobile     P2 --- Phase 2
                        app)                           
  ------------------------------------------------------------------------

**13. Glossary**

  -----------------------------------------------------------------------
  **Term**           **Definition**
  ------------------ ----------------------------------------------------
  Alumni             Former students who have graduated from the
                     institution

  Batch              The cohort of students who graduated in the same
                     year

  Chapter            A regional or thematic alumni sub-group within the
                     platform

  PRD                Product Requirements Document --- this document

  RSVP               Reservation confirmation for an event

  KPI                Key Performance Indicator --- a measurable success
                     metric

  DXA                Document eXtended Attribute --- a unit of
                     measurement in Word documents

  Yearbook           Digital browse of alumni by batch year and
                     department

  Notice Board       Social feed where members post updates, jobs, and
                     opportunities

  Marketplace        Section where alumni can list businesses and
                     services

  Patron Member      Highest-tier paid membership with maximum benefits
  -----------------------------------------------------------------------

*--- End of Document ---*

Alumni Connect PRD v1.0 \| Confidential \| 2026
