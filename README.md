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
- **Alumni Nearby Map** - OpenStreetMap/Leaflet map with clustering, a "Near me" radius search, batch/department/name filters and place search; shared locations are stored at ~1 km precision
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
- **PostgreSQL 17** - Primary database
- **Redis** - Caching and sessions
- **JWT** - Authentication

### Integrations
- **Razorpay** - Payment processing
- **AWS S3** - File storage
- **SendGrid/SMTP** - Email delivery
- **OpenStreetMap** - Map tiles (Leaflet) and place search (Nominatim, proxied by the API)

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
- Node.js 20+
- PostgreSQL 17 — or nothing at all: `npm run db:local -w server` runs an embedded PostgreSQL (no Docker)
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

3. **Start PostgreSQL** (skip if you already run PostgreSQL 17)
   ```bash
   # Embedded PostgreSQL 17 on 127.0.0.1:5433, data kept in server/.local-pg (add --fresh to wipe it)
   npm run db:local -w server
   ```
   Leave it running in its own terminal.

4. **Set up environment variables**
    ```bash
    # Server environment (required)
    copy server\.env.example server\.env

    # Client environment (optional overrides)
    copy client\.env.example client\.env.local

    # server\.env — matches the embedded database above:
    # DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/alumni_connect"
    ```

5. **Set up the database**
   ```bash
    cd server
    npx prisma generate
    npx prisma migrate deploy      # apply the committed migrations
    npm run db:seed                # admin account, tiers, skills, chapters, sample alumni
   ```
   Use `npx prisma migrate dev --name <change>` only when you change `schema.prisma`.

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

See `server/.env.example` (local) and `.env.docker.example` (docker-compose) for all variables:

- `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://postgres:postgres@127.0.0.1:5433/alumni_connect`)
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT tokens
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` - Payment gateway
- `AWS_*` - S3 bucket configuration
- `SMTP_*` - Email configuration
- `GOOGLE_*` / `LINKEDIN_*` - OAuth (optional)
- `GEOCODER_*` - Place search for the map (OpenStreetMap Nominatim by default; `GEOCODER_URL=off` disables it)
- `FEED_CACHE_TTL_SECONDS` - Public feed cache TTL in seconds
- `IMAGE_*` - Upload image compression and resize configuration

### Production Deployment

**Option 1: Backend on separate domain (Heroku, Railway, AWS, etc.)**

Frontend (on Netlify):
```bash
# In Netlify environment variables, set:
NEXT_PUBLIC_API_URL=https://your-backend-url.com/api
```

**Option 2: Backend and frontend on same domain**

If you have a reverse proxy (Nginx, Apache) or backend on same server as frontend:
```bash
# Frontend defaults to same-origin:
NEXT_PUBLIC_API_URL=/api
```

Then configure your proxy/server to route `/api/*` to your backend:
```nginx
# Nginx example
location /api {
  proxy_pass http://your-backend:5000/api;
}
```

**Option 3: Monolithic Netlify deployment with Functions**

If using Netlify Functions as your backend, set:
```bash
NEXT_PUBLIC_API_URL=/api
```

And configure Netlify to route `/api/*` requests to your functions.

**Failover (optional):**

For automatic failover to a secondary backend on network/gateway errors:
```bash
NEXT_PUBLIC_API_FALLBACK_URL=https://backup-api.yourdomain.com/api
```

Without `NEXT_PUBLIC_API_FALLBACK_URL`, the frontend will NOT attempt to construct or fall back to alternate domains. This prevents DNS errors on non-existent subdomains.

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
npm run db:local -w server   # Embedded PostgreSQL for local dev (no Docker)
```

## 👤 Default Seed Accounts

After `npm run db:seed` (or `cd server && npx prisma db seed`):

- **Admin:** `admin@aitdconnection.edu` / `Admin@123`
- **Sample Alumni/Open users:** `user1@example.com` to `user10@example.com` / `User@123`

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
- `GET /api/users/nearby` - Alumni within a radius, nearest first (optional batchYear/department/search)
- `GET /api/geo/search` / `GET /api/geo/reverse` - Place search and reverse geocoding for the map

The complete, generated endpoint list is in [docs/API_REFERENCE.md](docs/API_REFERENCE.md).

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

The full stack (PostgreSQL 17, Redis, API, web, optional nginx) runs from `docker-compose.yml`.
See **[docs/DOCKER.md](docs/DOCKER.md)** for the complete runbook (backups, upgrades, troubleshooting).

```bash
cp .env.docker.example .env
# Set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET (32+ chars each) and SEED_ADMIN_PASSWORD (12+ chars)

docker compose up -d --build
docker compose logs -f api
```

- Web: http://localhost:3000 · API: http://localhost:5000 (health: `/health`)
- The API container waits for PostgreSQL, runs `prisma migrate deploy`, and — with `SEED_ON_START=true` and
  `SEED_ADMIN_PASSWORD` set — idempotently seeds the super admin, tiers, skills and chapters.
- Data lives in the `postgres_data`, `redis_data` and `uploads_data` volumes. `docker compose down` keeps them;
  `docker compose down -v` deletes them.
- Single origin behind nginx on :80: `docker compose --profile proxy up -d --build`, with
  `NEXT_PUBLIC_API_URL=http(s)://<host>/api` (it is baked into the web image at build time).

### Individual Docker Builds

Both Dockerfiles build from the repository root (npm workspaces):

```bash
docker build -f server/Dockerfile -t alumni-connect-api .
docker build -f client/Dockerfile -t alumni-connect-web --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api .
```

## 🔄 CI/CD

The project includes GitHub Actions workflows for:

- **Backend CI** - Typecheck, lint, unit tests, integration tests against a `postgres:17-alpine` service, build
- **Frontend CI** - Linting and building the Next.js app
- **Docker Build** - Validates `docker-compose.yml`, builds and pushes images (main branch)

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

# Integration tests against a real (embedded) PostgreSQL
cd server && npm run test:integration

# Frontend tests
cd client && npm test
```

See [docs/TESTING.md](docs/TESTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 👥 Contributors

Built with ❤️ for the alumni community.
