# Getting Started with Alumni Connect

This guide will walk you through setting up the Alumni Connect platform on your local development environment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18.0.0 or higher) - [Download](https://nodejs.org/)
- **PostgreSQL** (v14 or higher) - [Download](https://www.postgresql.org/download/)
- **Git** - [Download](https://git-scm.com/)
- **Redis** (optional, for caching) - [Download](https://redis.io/download)

### Verify installations

```bash
node --version    # Should be v18.x or higher
npm --version     # Should be v9.x or higher
psql --version    # Should be v14 or higher
```

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/atreyakamat/aitd-alumni-network.git
cd aitd-alumni-network
```

### 2. Install Dependencies

```bash
npm install
```

This installs dependencies for both the client and server workspaces.

### 3. Set Up PostgreSQL Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create the database
CREATE DATABASE alumni_connect;

# Exit psql
\q
```

### 4. Configure Environment Variables

Create the server environment file:

```bash
# Windows
copy server\.env.example server\.env

# macOS/Linux
cp server/.env.example server/.env
```

Edit `server/.env` with your configuration:

```env
# Database
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/alumni_connect?schema=public"

# JWT Secrets (generate strong secrets for production!)
JWT_SECRET="your-super-secret-jwt-key"
JWT_REFRESH_SECRET="your-super-secret-refresh-key"
JWT_EXPIRES_IN="24h"
JWT_REFRESH_EXPIRES_IN="7d"

# Server
PORT=5000
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"
CORS_ORIGINS="http://localhost:3000"

# Optional: Redis (for caching)
REDIS_URL="redis://localhost:6379"

# Optional: Email (for sending verification emails)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
EMAIL_FROM="noreply@alumniconnect.edu"

# Optional: Razorpay (for payments)
RAZORPAY_KEY_ID="rzp_test_xxx"
RAZORPAY_KEY_SECRET="xxx"
```

### 5. Initialize the Database

```bash
cd server

# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to view data
npx prisma studio
```

### 6. Start Development Servers

From the root directory:

```bash
# Start both client and server
npm run dev
```

Or start them separately:

```bash
# Terminal 1 - Start backend
npm run dev --workspace=server

# Terminal 2 - Start frontend  
npm run dev --workspace=client
```

### 7. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **API Health Check**: http://localhost:5000/health
- **Prisma Studio**: http://localhost:5555 (if running)

## Testing the API

You can test the API using curl or Postman:

### Register a new user

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alumni@example.com",
    "password": "SecurePass123!",
    "fullName": "John Doe",
    "batchYear": 2020,
    "department": "Computer Science",
    "degree": "B.Tech"
  }'
```

### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alumni@example.com",
    "password": "SecurePass123!"
  }'
```

### Access protected endpoint

```bash
# Replace TOKEN with the accessToken from login response
curl http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer TOKEN"
```

## Project Structure

```
aitd-alumni-network/
├── client/                     # Next.js Frontend
│   ├── src/
│   │   ├── app/               # App Router pages
│   │   │   ├── (auth)/       # Auth pages (login, register)
│   │   │   ├── (main)/       # Main app pages
│   │   │   └── layout.tsx    # Root layout
│   │   ├── components/        # React components
│   │   │   ├── ui/           # Base UI components
│   │   │   ├── layout/       # Layout components
│   │   │   └── features/     # Feature components
│   │   ├── context/          # React context providers
│   │   ├── hooks/            # Custom React hooks
│   │   ├── lib/              # Utilities & API client
│   │   └── types/            # TypeScript types
│   ├── public/               # Static assets
│   ├── tailwind.config.ts    # Tailwind configuration
│   └── package.json
│
├── server/                    # Express.js Backend
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema
│   │   ├── migrations/       # Database migrations
│   │   └── seed.ts          # Seed data script
│   ├── src/
│   │   ├── config/           # Configuration files
│   │   │   ├── database.ts   # Prisma client
│   │   │   ├── redis.ts      # Redis client
│   │   │   └── index.ts      # App config
│   │   ├── controllers/      # Route handlers
│   │   ├── middleware/       # Express middleware
│   │   │   ├── auth.ts       # JWT authentication
│   │   │   ├── validate.ts   # Request validation
│   │   │   └── errorHandler.ts
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   └── utils/            # Helper functions
│   └── package.json
│
├── docs/                      # Documentation
├── .env.example              # Environment template
├── package.json              # Root package.json
└── README.md
```

## API Endpoints Overview

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| POST | `/api/auth/logout` | Logout user |
| POST | `/api/auth/refresh-token` | Refresh access token |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/verify-email` | Verify email |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/directory` | Search alumni directory |
| GET | `/api/users/:id` | Get user profile |
| PATCH | `/api/users/profile` | Update profile |
| GET | `/api/users/yearbook/:year` | Get yearbook by batch |
| GET | `/api/users/nearby` | Get alumni locations |

### Posts (Social Feed)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/posts` | Get feed |
| POST | `/api/posts` | Create post |
| GET | `/api/posts/:id` | Get single post |
| PATCH | `/api/posts/:id` | Update post |
| DELETE | `/api/posts/:id` | Delete post |
| POST | `/api/posts/:id/like` | Like/unlike post |
| POST | `/api/posts/:postId/comments` | Add comment |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List job postings |
| POST | `/api/jobs` | Create job posting |
| GET | `/api/jobs/:id` | Get job details |
| PATCH | `/api/jobs/:id` | Update job |
| POST | `/api/jobs/:id/apply` | Apply for job |

### Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | List events |
| POST | `/api/events` | Create event |
| GET | `/api/events/:id` | Get event details |
| POST | `/api/events/:id/rsvp` | RSVP to event |

### Network (Connections)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/network/connections` | Get connections |
| GET | `/api/network/suggestions` | Get suggestions |
| POST | `/api/network/request/:userId` | Send request |
| POST | `/api/network/respond/:id` | Accept/reject |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | Get conversations |
| GET | `/api/messages/:partnerId` | Get messages |
| POST | `/api/messages/:receiverId` | Send message |
| GET | `/api/messages/unread` | Get unread count |

### Gallery
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gallery` | List albums |
| POST | `/api/gallery` | Create album |
| POST | `/api/gallery/:id/photos` | Add photos |

### News & Stories
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/news` | List articles |
| GET | `/api/news/:slug` | Get article |
| POST | `/api/news` | Create article (admin) |

### Chapters
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chapters` | List chapters |
| GET | `/api/chapters/:id` | Get chapter |
| POST | `/api/chapters/:id/join` | Join chapter |

### Memberships
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memberships/tiers` | List tiers |
| GET | `/api/memberships/my` | Get my membership |
| POST | `/api/memberships/order` | Create order |
| POST | `/api/memberships/verify` | Verify payment |

### Donations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/donations/order` | Create donation |
| POST | `/api/donations/verify` | Verify donation |
| GET | `/api/donations/history` | Donation history |

## Common Issues & Solutions

### Port Already in Use

If port 3000 or 5000 is already in use:

```bash
# Find process using port (Windows)
netstat -ano | findstr :3000

# Kill process by PID
taskkill /PID <PID> /F
```

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Verify credentials in `.env`
3. Check if database exists:
   ```bash
   psql -U postgres -c "\l"
   ```

### Prisma Issues

```bash
# Reset database and run migrations
cd server
npx prisma migrate reset

# Regenerate Prisma Client
npx prisma generate
```

### CORS Issues

If you see CORS errors in browser console:
1. Check `CORS_ORIGINS` in server `.env`
2. Ensure frontend URL matches exactly (including port)

## Development Tips

### Hot Reload

Both client and server support hot reload during development:
- Client uses Next.js Fast Refresh
- Server uses `tsx watch` for TypeScript watching

### Database Management

```bash
# Open Prisma Studio (visual DB browser)
cd server && npx prisma studio

# View database schema
npx prisma db pull

# Format schema file
npx prisma format
```

### API Testing

Use the health endpoint to verify the server is running:
```bash
curl http://localhost:5000/health
```

### Logging

Server logs are printed to console in development. Look for:
- `🚀 Server running on http://localhost:5000`
- Request/response logs
- Error stack traces

## Next Steps

After successful setup:

1. **Register an account** at http://localhost:3000/register
2. **Verify your email** (or manually set `isVerified=true` in database)
3. **Complete your profile** with education and work experience
4. **Explore features** like posts, jobs, events, and directory

## Getting Help

If you encounter issues:

1. Check the console for error messages
2. Review the API response in browser DevTools
3. Check server logs for backend errors
4. Verify environment variables are set correctly

## License

This project is proprietary software for AITD Alumni Association.
