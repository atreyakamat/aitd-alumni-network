# AITD Connection

A comprehensive alumni network platform built with Next.js and Express.js, designed to connect graduates, facilitate networking, and foster a thriving alumni community.

## 🚀 Features

### Core Features
- **Alumni Directory** - Search and connect with alumni across batches and departments
- **Social Feed** - Share updates, achievements, and announcements
- **Job Board** - Post and discover career opportunities
- **Events** - Organize and RSVP to reunions, workshops, and meetups
- **Messaging** - Real-time direct messaging with Socket.io
- **Notifications** - Real-time notification badges and updates

### Additional Features
- **Alumni Nearby Map** - Interactive map with clustering to find alumni near you
- **Photo Gallery** - Browse event photos and memories
- **News & Stories** - Alumni spotlights and college updates
- **Chapters** - Regional alumni groups with donation tracking
- **Marketplace** - Buy/sell items within the network
- **Donations** - Support your alma mater with leaderboards and impact tracking
- **Memberships** - Premium membership tiers with Razorpay integration
- **Mentorship** - Connect mentors with mentees
- **Invite Batchmates** - Bulk CSV invite with branded email templates
- **Admin Analytics** - Dashboard with user growth, revenue, and engagement charts

### Security Features
- **Two-Factor Authentication (2FA)** - Email-based OTP verification
- **OAuth Login** - Google and LinkedIn authentication
- **JWT Authentication** - Access and refresh token management

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
- **MySQL** - Primary database
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
- MySQL 8.0+
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

3. **Set up MySQL database**
   ```bash
   mysql -u root -p -e "CREATE DATABASE alumni_connect;"
   ```

4. **Set up environment variables**
    ```bash
    # Server environment (required)
    copy server\.env.example server\.env

    # Client environment (optional overrides)
    copy client\.env.example client\.env.local

    # Edit server\.env with your MySQL credentials
    # DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/alumni_connect"
    ```

5. **Set up the database**
   ```bash
    # Generate Prisma client
    cd server && npx prisma generate
    
    # Run migrations
    npx prisma migrate dev

    # Production deployment migrations
    npx prisma migrate deploy

    # If deploying to an existing non-empty DB for the first time,
    # baseline already-applied migrations before deploy:
    # npx prisma migrate resolve --applied <migration_name>
    
    # (Optional) Seed the database
    npx prisma db seed
   ```

6. **Start development servers**
   ```bash
   # From root directory
   npm run dev
   ```

This starts:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000
- Health check (includes DB status): http://localhost:5000/health

## 📝 Environment Variables

See `.env.example` for all required environment variables:

- `DATABASE_URL` - MySQL connection string (e.g., `mysql://root:password@localhost:3306/alumni_connect`)
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT tokens
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` - Payment gateway
- `AWS_*` - S3 bucket configuration
- `SMTP_*` - Email configuration
- `GOOGLE_*` - OAuth and Maps API
- `FEED_CACHE_TTL_SECONDS` - Public feed cache TTL in seconds
- `IMAGE_*` - Upload image compression and resize configuration

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
npm run db:deploy        # Deploy migrations (production-safe)
npm run db:seed          # Seed the database
npm run db:studio        # Open Prisma Studio
```

## 📚 API Documentation

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (returns 2FA prompt if enabled)
- `POST /api/auth/verify-2fa` - Verify 2FA OTP code
- `POST /api/auth/resend-2fa` - Resend 2FA OTP code
- `POST /api/auth/2fa/enable` - Enable 2FA for account
- `POST /api/auth/2fa/disable` - Disable 2FA for account
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/oauth/providers` - Check configured OAuth providers

### Users
- `GET /api/users/directory` - Search alumni directory
- `GET /api/users/:id` - Get user profile
- `PATCH /api/users/profile` - Update own profile
- `GET /api/users/yearbook/:year` - Get yearbook by batch
- `GET /api/users/locations` - Get map markers (supports optional bounds: north/south/east/west)
- `GET /api/users/nearby` - Get alumni near a location

### Invites
- `POST /api/invites/send` - Send single invite
- `POST /api/invites/bulk` - Send bulk invites via CSV
- `POST /api/invites/generate-link` - Generate shareable invite link
- `GET /api/invites/sent` - Get sent invites
- `GET /api/invites/stats` - Get invite statistics
- `GET /api/invites/verify/:token` - Verify invite token
- `POST /api/invites/:token/accept` - Accept invite

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

## 🐳 Docker Deployment

### Quick Start with Docker Compose

```bash
# Copy environment variables
cp .env.example .env
# Edit .env with your configuration

# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

This starts:
- **MySQL** - Database on port 3306
- **Redis** - Cache on port 6379
- **API** - Backend on port 5000
- **Web** - Frontend on port 3000

### Production Deployment

```bash
# Build images
docker-compose build

# Run with production profile (includes Nginx)
docker-compose --profile production up -d
```

### Individual Docker Builds

```bash
# Build server
cd server && docker build -t alumni-connect-api .

# Build client
cd client && docker build -t alumni-connect-web --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api .
```

## 🔄 CI/CD

The project includes GitHub Actions workflows for:

- **Backend CI** - Linting, testing, and building the Express server
- **Frontend CI** - Linting and building the Next.js app
- **Docker Build** - Building and pushing Docker images on main branch

See `.github/workflows/ci.yml` for the full configuration.

### Required GitHub Secrets
- `DOCKER_USERNAME` - Docker Hub username
- `DOCKER_PASSWORD` - Docker Hub password/access token

## 🧪 Testing

```bash
# Run backend tests
cd server && npm test

# Run with coverage
cd server && npm run test:coverage

# Watch mode
cd server && npm run test:watch
```

## 👥 Contributors

Built with ❤️ for the alumni community.
