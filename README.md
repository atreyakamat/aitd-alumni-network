# Alumni Connect

A comprehensive alumni network platform built with Next.js and Express.js, designed to connect graduates, facilitate networking, and foster a thriving alumni community.

## 🚀 Features

### Core Features
- **Alumni Directory** - Search and connect with alumni across batches and departments
- **Social Feed** - Share updates, achievements, and announcements
- **Job Board** - Post and discover career opportunities
- **Events** - Organize and RSVP to reunions, workshops, and meetups
- **Messaging** - Direct messaging between connected alumni
- **Notifications** - Stay updated on network activity

### Additional Features
- **Photo Gallery** - Browse event photos and memories
- **News & Stories** - Alumni spotlights and college updates
- **Chapters** - Regional alumni groups
- **Marketplace** - Buy/sell items within the network
- **Donations** - Support your alma mater
- **Memberships** - Premium membership tiers with Razorpay integration
- **Mentorship** - Connect mentors with mentees

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **TanStack Query** - Data fetching and caching
- **React Hook Form** - Form management with Zod validation

### Backend
- **Express.js** - Node.js web framework
- **TypeScript** - Type-safe backend
- **Prisma** - Database ORM
- **PostgreSQL** - Primary database
- **Redis** - Caching and sessions
- **JWT** - Authentication

### Integrations
- **Razorpay** - Payment processing
- **AWS S3** - File storage
- **SendGrid/SMTP** - Email delivery
- **Google Maps API** - Alumni locations

## 📁 Project Structure

```
aitd-alumni-network/
├── client/                 # Next.js frontend
│   ├── src/
│   │   ├── app/           # App Router pages
│   │   ├── components/    # React components
│   │   ├── context/       # React context providers
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Utilities and API client
│   │   └── types/         # TypeScript types
│   └── public/            # Static assets
│
├── server/                 # Express.js backend
│   ├── prisma/            # Database schema and seeds
│   └── src/
│       ├── config/        # Configuration
│       ├── controllers/   # Route handlers
│       ├── middleware/    # Express middleware
│       ├── routes/        # API routes
│       ├── services/      # Business logic
│       └── utils/         # Helper functions
│
├── docs/                   # Documentation
└── package.json           # Root package.json with workspaces
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis (optional, for caching)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/atreyakamat/aitd-alumni-network.git
   cd aitd-alumni-network
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**
   ```bash
   # Generate Prisma client
   cd server && npx prisma generate
   
   # Run migrations
   npx prisma migrate dev
   
   # (Optional) Seed the database
   npx prisma db seed
   ```

5. **Start development servers**
   ```bash
   # From root directory
   npm run dev
   ```

   This starts:
   - Frontend: http://localhost:3000
   - Backend: http://localhost:5000

## 📝 Environment Variables

See `.env.example` for all required environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT tokens
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` - Payment gateway
- `AWS_*` - S3 bucket configuration
- `SMTP_*` - Email configuration
- `GOOGLE_*` - OAuth and Maps API

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start both client and server

# Building
npm run build            # Build both client and server
npm run build:client     # Build frontend only
npm run build:server     # Build backend only

# Production
npm start                # Start production server

# Database
npm run db:migrate       # Run Prisma migrations
npm run db:seed          # Seed the database
npm run db:studio        # Open Prisma Studio
```

## 📚 API Documentation

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

### Users
- `GET /api/users/directory` - Search alumni directory
- `GET /api/users/:id` - Get user profile
- `PATCH /api/users/profile` - Update own profile
- `GET /api/users/yearbook/:year` - Get yearbook by batch

### Posts
- `GET /api/posts` - Get feed
- `POST /api/posts` - Create post
- `POST /api/posts/:id/like` - Like/unlike post
- `POST /api/posts/:id/comments` - Add comment

### Jobs
- `GET /api/jobs` - List jobs
- `POST /api/jobs` - Create job posting
- `GET /api/jobs/:id` - Get job details

### Events
- `GET /api/events` - List events
- `POST /api/events` - Create event
- `POST /api/events/:id/rsvp` - RSVP to event

### Network
- `GET /api/network/connections` - Get connections
- `POST /api/network/request/:userId` - Send connection request
- `POST /api/network/respond/:id` - Accept/reject request

### Messages
- `GET /api/messages` - Get conversations
- `GET /api/messages/:partnerId` - Get messages with user
- `POST /api/messages/:receiverId` - Send message

## 🎨 Design System

The UI follows a LinkedIn-inspired design system:

### Colors
- **Primary Blue**: `#0A66C2`
- **Dark Blue**: `#004182`
- **Background**: `#F3F2EF`
- **Surface**: `#FFFFFF`
- **Text Primary**: `#1E1E1E`
- **Text Secondary**: `#5E5E5E`

### Typography
- Font: Inter
- Headings: Bold, various sizes
- Body: Regular, 14-16px

## 🔐 Security

- JWT-based authentication with refresh tokens
- Password hashing with bcrypt
- Rate limiting on auth endpoints
- CORS protection
- Helmet.js security headers
- Input validation with Zod

## 📄 License

This project is proprietary software for AITD Alumni Association.

## 👥 Contributors

Built with ❤️ for the alumni community.
