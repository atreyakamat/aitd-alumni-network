# AITD Alumni Network - Extensive Production Deployment Guide

## Complete Reference Manual for aitd.stixnvibes.com

This document covers every single detail required for successful production deployment of the AITD Alumni Network.

---

## TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [Environment Variables - Complete Reference](#environment-variables)
3. [Frontend Deployment (Netlify)](#frontend-deployment)
4. [Backend Deployment (Railway/Render)](#backend-deployment)
5. [Database Configuration](#database-configuration)
6. [Third-Party Services Setup](#third-party-services)
7. [Domain & DNS Configuration](#domain-dns)
8. [SSL/TLS Certificates](#ssl-tls)
9. [Security Hardening](#security-hardening)
10. [Monitoring & Logging](#monitoring-logging)
11. [Performance Optimization](#performance-optimization)
12. [Scaling & Load Balancing](#scaling)
13. [Backup & Disaster Recovery](#backup-recovery)
14. [Post-Deployment Maintenance](#maintenance)
15. [Troubleshooting Guide](#troubleshooting)
16. [API Documentation](#api-docs)

---

## PROJECT OVERVIEW {#project-overview}

### Architecture Summary
- **Frontend**: Next.js (React) deployed on Netlify
- **Backend**: Express.js REST API deployed on Railway/Render/DigitalOcean
- **Database**: MySQL (external hosted)
- **Domain**: aitd.stixnvibes.com (primary domain)
- **API Subdomain**: api.aitd.stixnvibes.com (optional, for direct API calls)

### Technology Stack
- Node.js 18+
- TypeScript
- Prisma ORM (database)
- Express.js
- Next.js 13+
- MySQL 8.0+
- npm workspaces (monorepo structure)

### Key Features
- 80+ API routes across 16 categories
- User authentication with JWT and 2FA
- OAuth integration (Google, LinkedIn)
- Email notifications (SendGrid)
- Payment processing (Razorpay)
- File uploads (AWS S3)
- Real-time messaging capabilities
- Admin dashboard
- Comprehensive audit logging

---

## ENVIRONMENT VARIABLES - COMPLETE REFERENCE {#environment-variables}

### Frontend Environment Variables (client/.env)

```env
# API Configuration
NEXT_PUBLIC_API_URL=https://api.aitd.stixnvibes.com/api

# OAuth Configuration (Public - safe to expose)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id_here
NEXT_PUBLIC_LINKEDIN_CLIENT_ID=your_linkedin_client_id_here

# Analytics (optional)
NEXT_PUBLIC_GA_TRACKING_ID=your_ga_tracking_id
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
```

**Explanation:**
- `NEXT_PUBLIC_API_URL`: Base URL for all API calls. Must match backend domain
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth client ID from Google Cloud Console
- `NEXT_PUBLIC_LINKEDIN_CLIENT_ID`: LinkedIn OAuth client ID from LinkedIn Developer Portal
- `NEXT_PUBLIC_GA_TRACKING_ID`: Google Analytics tracking ID (optional)
- `NEXT_PUBLIC_SENTRY_DSN`: Sentry error tracking DSN (optional)

### Backend Environment Variables (server/.env)

```env
# Environment
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=mysql://username:password@119.18.54.49:3306/aitd_alumni

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters_long
JWT_REFRESH_SECRET=your_super_secret_refresh_key_minimum_32_characters_long
JWT_EXPIRY=7d
JWT_REFRESH_EXPIRY=30d

# Frontend URL (for CORS and redirects)
FRONTEND_URL=https://aitd.stixnvibes.com

# CORS Origins (comma-separated)
CORS_ORIGINS=https://aitd.stixnvibes.com,https://www.aitd.stixnvibes.com

# Email Configuration (SendGrid)
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@aitd.stixnvibes.com
SENDGRID_REPLY_TO_EMAIL=support@aitd.stixnvibes.com

# OAuth Secrets
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret

# Payment Gateway (Razorpay)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# File Storage (AWS S3)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_S3_BUCKET=aitd-alumni-network
AWS_S3_REGION=us-east-1

# 2FA Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_AUTH_MAX_REQUESTS=10

# Logging & Monitoring
SENTRY_DSN=your_sentry_dsn
LOG_LEVEL=info
```

**Detailed Explanations:**

1. **NODE_ENV**: Must be "production" for production deployments
2. **PORT**: Internal port (Netlify/Railway will expose via standard HTTP/HTTPS)
3. **DATABASE_URL**: 
   - Format: `mysql://username:password@host:port/database`
   - Host: 119.18.54.49 (your MySQL server)
   - Port: 3306 (default MySQL port)
   - Database: aitd_alumni (create this database beforehand)
4. **JWT_SECRET**: Use strong random string (minimum 32 chars): `openssl rand -hex 32`
5. **JWT_REFRESH_SECRET**: Different from JWT_SECRET for extra security
6. **JWT_EXPIRY**: How long access token lasts (7d = 7 days)
7. **JWT_REFRESH_EXPIRY**: How long refresh token lasts (30d = 30 days)
8. **CORS_ORIGINS**: Comma-separated list of allowed frontend URLs
9. **SENDGRID_API_KEY**: From SendGrid account settings
10. **RAZORPAY_KEY_ID/SECRET**: From Razorpay dashboard
11. **AWS_S3_BUCKET**: S3 bucket name for file uploads
12. **TWILIO_***: For 2FA SMS verification
13. **RATE_LIMIT_***: Controls API rate limiting (100 req/15 min for general, 10 for auth)

---

## FRONTEND DEPLOYMENT (NETLIFY) {#frontend-deployment}

### Step-by-Step Netlify Deployment

#### 1. Create Netlify Account
- Go to https://app.netlify.com
- Sign up with GitHub account
- Grant repository access

#### 2. Create New Netlify Site
- Click "Add new site"
- Select "Import an existing project"
- Choose GitHub repository: `atreyakamat/aitd-alumni-network`
- Select branch: `main` (or your production branch)

#### 3. Build Configuration
- Build command: `npm run build:client`
- Publish directory: `client/.next`
- Base directory: `.` (root)

#### 4. Environment Variables in Netlify
1. Go to Site settings → Build & deploy → Environment
2. Add all frontend env vars from `client/.env`:
   - NEXT_PUBLIC_API_URL
   - NEXT_PUBLIC_GOOGLE_CLIENT_ID
   - NEXT_PUBLIC_LINKEDIN_CLIENT_ID

#### 5. Deploy Site
- Netlify will automatically deploy on push to `main`
- Deployment preview for pull requests
- Monitor build logs in Netlify dashboard

#### 6. Continuous Deployment
Every push to `main` branch automatically triggers:
1. Clone repository
2. Run: `npm install`
3. Run: `npm run build:client`
4. Deploy to Netlify CDN
5. Available at: https://aitd.stixnvibes.com

### netlify.toml Configuration Details

```toml
[build]
command = "npm run build:client"
publish = "client/.next"
base = "."

[build.environment]
NODE_VERSION = "18.17.0"
NPM_VERSION = "9.8.1"

# Security Headers
[[headers]]
for = "/*"
[headers.values]
X-Frame-Options = "SAMEORIGIN"
X-Content-Type-Options = "nosniff"
X-XSS-Protection = "1; mode=block"
Referrer-Policy = "strict-origin-when-cross-origin"
Permissions-Policy = "geolocation=(), microphone=(), camera=()"
Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"

# Caching Strategies
[[headers]]
for = "/_next/static/*"
[headers.values]
Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
for = "/images/*"
[headers.values]
Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
for = "/"
[headers.values]
Cache-Control = "public, max-age=3600, must-revalidate"

# API Redirects
[[redirects]]
from = "/api/*"
to = "https://api.aitd.stixnvibes.com/api/:splat"
status = 200
force = true

# Clean URLs
[[redirects]]
from = "/*"
to = "/index.html"
status = 200
```

---

## BACKEND DEPLOYMENT (RAILWAY/RENDER) {#backend-deployment}

### Option A: Railway.app (Recommended)

#### 1. Create Railway Account
- Go to https://railway.app
- Sign up with GitHub
- Connect GitHub repository

#### 2. Create New Project
- Click "New Project"
- Select "Deploy from GitHub repo"
- Choose: `atreyakamat/aitd-alumni-network`

#### 3. Configure Build
- Framework: Node.js
- Start command: `npm run start --workspace=server`
- Build command: `npm run build --workspace=server`

#### 4. Add Environment Variables
In Railway project settings, add all `server/.env` variables

#### 5. Deploy
- Railway automatically deploys on push to `main`
- Gets assigned Railway domain (e.g., api-xyz.railway.app)

#### 6. Configure DNS
- Update your domain registrar
- Add CNAME: `api.aitd.stixnvibes.com` → `api-xyz.railway.app`

### Option B: Render.com

#### 1. Create Render Account
- Go to https://render.com
- Sign up with GitHub

#### 2. Create New Web Service
- Click "New +" → "Web Service"
- Connect GitHub repository
- Branch: `main`
- Root directory: `server`

#### 3. Configuration
- Build command: `npm run build`
- Start command: `npm run start`
- Node version: 18.17.0

#### 4. Environment Variables
Add all variables from `server/.env` in Render dashboard

#### 5. Deploy
- Render deploys automatically on push
- Gets unique Render URL

### Option C: DigitalOcean App Platform

#### 1. Create DigitalOcean Account
- Go to https://www.digitalocean.com
- Create account

#### 2. Create New App
- Go to Apps → Create App
- Connect GitHub repository
- Select branch: `main`

#### 3. App Spec Configuration
```yaml
name: aitd-api
services:
- name: api
  github:
    repo: atreyakamat/aitd-alumni-network
    branch: main
  source_dir: server
  build_command: npm run build
  run_command: npm run start
  http_port: 3001
  envs:
  - key: NODE_ENV
    value: production
  - key: DATABASE_URL
    scope: RUN_AND_BUILD_TIME
    value: ${db.connection_string}
```

#### 4. Database Connection
- Create managed MySQL database on DigitalOcean
- Use connection string in `DATABASE_URL`

---

## DATABASE CONFIGURATION {#database-configuration}

### MySQL Database Setup

#### 1. Create Database

```sql
CREATE DATABASE aitd_alumni CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aitd_user'@'119.18.54.49' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON aitd_alumni.* TO 'aitd_user'@'119.18.54.49';
FLUSH PRIVILEGES;
```

#### 2. Connection String Format
```
mysql://aitd_user:strong_password_here@119.18.54.49:3306/aitd_alumni?charset=utf8mb4
```

#### 3. Run Prisma Migrations
```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

#### 4. Seed Initial Data (if needed)
```bash
npx prisma db seed
```

### Database Backup & Recovery

#### Automated Backups
```bash
# Daily backup script (backup.sh)
#!/bin/bash
BACKUP_DIR="/backups/mysql"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mysqldump -u aitd_user -p'password' \
  -h 119.18.54.49 \
  aitd_alumni > $BACKUP_DIR/backup_$TIMESTAMP.sql
gzip $BACKUP_DIR/backup_$TIMESTAMP.sql
# Keep only last 30 days
find $BACKUP_DIR -mtime +30 -delete
```

#### Restore from Backup
```bash
mysql -u aitd_user -p -h 119.18.54.49 aitd_alumni < backup_20240115_120000.sql
```

---

## THIRD-PARTY SERVICES SETUP {#third-party-services}

### SendGrid (Email Service)

#### 1. Create Account
- Go to https://sendgrid.com
- Sign up for free or paid plan
- Verify domain ownership

#### 2. Generate API Key
- Go to Settings → API Keys
- Click "Create API Key"
- Choose "Restricted Access"
- Enable: "Mail Send"
- Copy key to `SENDGRID_API_KEY`

#### 3. Sender Authentication
- Add verified sender: noreply@aitd.stixnvibes.com
- Verify via email link
- Add CNAME records to domain if using domain authentication

#### 4. Email Templates (optional)
- Create reusable templates in SendGrid dashboard
- Reference template IDs in code

### Google OAuth Setup

#### 1. Create Google Cloud Project
- Go to https://console.cloud.google.com
- Create new project: "AITD Alumni"

#### 2. Create OAuth 2.0 Credentials
- Go to Credentials → Create Credentials → OAuth 2.0 Client ID
- Application type: "Web application"
- Name: "AITD Alumni Network"

#### 3. Add Authorized URLs
- Authorized JavaScript origins: `https://aitd.stixnvibes.com`
- Authorized redirect URIs:
  - `https://aitd.stixnvibes.com/auth/google/callback`
  - `https://aitd.stixnvibes.com/auth/callback`

#### 4. Copy Credentials
- Client ID → `GOOGLE_CLIENT_ID`
- Client Secret → `GOOGLE_CLIENT_SECRET`

### LinkedIn OAuth Setup

#### 1. Create LinkedIn App
- Go to https://www.linkedin.com/developers/apps
- Click "Create app"
- App name: "AITD Alumni Network"
- LinkedIn Page: Select or create

#### 2. Add Authorized Redirect URLs
- Go to Auth → Authorized redirect URLs
- Add: `https://aitd.stixnvibes.com/auth/linkedin/callback`

#### 3. Copy Credentials
- Client ID → `LINKEDIN_CLIENT_ID`
- Client Secret → `LINKEDIN_CLIENT_SECRET`

### Razorpay (Payment Processing)

#### 1. Create Razorpay Account
- Go to https://razorpay.com
- Sign up and verify identity
- Complete KYC process

#### 2. Get API Keys
- Go to Settings → API Keys
- Key ID → `RAZORPAY_KEY_ID`
- Key Secret → `RAZORPAY_KEY_SECRET`

#### 3. Configure Webhooks
- Add webhook URL: `https://api.aitd.stixnvibes.com/webhooks/razorpay`
- Events: payment.authorized, payment.failed, payment.captured

### AWS S3 (File Storage)

#### 1. Create AWS Account
- Go to https://aws.amazon.com
- Create account and add payment method

#### 2. Create IAM User
- Go to IAM → Users → Create user
- Username: `aitd-app`
- Enable programmatic access

#### 3. Create S3 Bucket
- Go to S3 → Create bucket
- Name: `aitd-alumni-network`
- Region: us-east-1
- Block public access: enabled
- Versioning: enabled
- Enable encryption

#### 4. Add Permissions
- Create bucket policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::aitd-alumni-network/*"
    }
  ]
}
```

#### 5. Copy Credentials
- Access Key ID → `AWS_ACCESS_KEY_ID`
- Secret Access Key → `AWS_SECRET_ACCESS_KEY`

---

## DOMAIN & DNS CONFIGURATION {#domain-dns}

### Register Domain
- Domain: `aitd.stixnvibes.com`
- Registrar: (GoDaddy, Namecheap, etc.)

### DNS Records Setup

#### Frontend DNS Record
```
Type: CNAME
Name: aitd
Value: aitd-stixnvibes-xyz.netlify.app
TTL: 3600
```

#### API DNS Record (if using separate subdomain)
```
Type: CNAME
Name: api
Value: api-xyz.railway.app (or your backend domain)
TTL: 3600
```

#### Root Domain (Optional)
```
Type: A
Name: @ (root)
Value: 75.2.60.5 (Netlify IP - verify with Netlify)
TTL: 3600
```

#### Mail Records (if using custom email)
```
Type: MX
Name: @
Value: mx.sendgrid.net
Priority: 10
TTL: 3600

Type: CNAME
Name: sendgrid
Value: sendgrid.net
TTL: 3600
```

### DNS Verification
```bash
# Verify DNS propagation
nslookup aitd.stixnvibes.com
nslookup api.aitd.stixnvibes.com
```

---

## SSL/TLS CERTIFICATES {#ssl-tls}

### Netlify SSL
- Automatic: Netlify provides free SSL via Let's Encrypt
- Auto-renewal every 90 days
- HTTPS enforced by default

### Backend SSL
- Railway/Render: Provide free SSL certificates
- DigitalOcean: Automatic or manual setup via Let's Encrypt

### Force HTTPS
Add to netlify.toml:
```toml
[[redirects]]
from = "http://aitd.stixnvibes.com/*"
to = "https://aitd.stixnvibes.com/:splat"
status = 301
force = true
```

---

## SECURITY HARDENING {#security-hardening}

### Rate Limiting Configuration

```javascript
// Default: 100 requests per 15 minutes
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=900000

// Auth endpoints: 10 requests per 15 minutes
RATE_LIMIT_AUTH_MAX_REQUESTS=10
```

### CORS Security

**Current Configuration:**
```javascript
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];
app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### Security Headers

```
X-Frame-Options: SAMEORIGIN          # Prevent clickjacking
X-Content-Type-Options: nosniff      # Prevent MIME sniffing
X-XSS-Protection: 1; mode=block      # XSS protection
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### Password Security
- Minimum 8 characters (enforced in validation)
- Hashing: bcrypt with 10 salt rounds
- Never store plaintext passwords
- Password reset via email link with 1-hour expiry

### API Key Security
- Store in environment variables (never in code)
- Rotate keys quarterly
- Use separate keys for development/production
- Revoke compromised keys immediately

### 2FA Implementation
- SMS-based via Twilio
- TOTP codes (backup option)
- Enforce for admin accounts
- Optional for regular users

---

## MONITORING & LOGGING {#monitoring-logging}

### Sentry Error Tracking

#### 1. Create Sentry Account
- Go to https://sentry.io
- Sign up for free account

#### 2. Create Projects
- Create project for frontend (Next.js)
- Create project for backend (Node.js)

#### 3. Add DSN to Environment
```
NEXT_PUBLIC_SENTRY_DSN=https://key@sentry.io/project-id (frontend)
SENTRY_DSN=https://key@sentry.io/project-id (backend)
```

#### 4. Configure Alerts
- Alert on error threshold (e.g., 10 errors per minute)
- Slack integration for notifications
- Weekly digest emails

### Application Logging

```javascript
// Structured logging using Winston
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### Monitoring Metrics

Key metrics to track:
- Response time (p50, p95, p99)
- Error rate (5xx errors)
- Authentication success rate
- API endpoint performance
- Database query time
- File upload success rate

### Health Check Endpoint

```
GET https://api.aitd.stixnvibes.com/health

Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600,
  "database": "connected"
}
```

---

## PERFORMANCE OPTIMIZATION {#performance-optimization}

### Frontend Optimization

1. **Code Splitting**
   - Automatic in Next.js
   - Dynamic imports for heavy components

2. **Image Optimization**
   - Use Next.js Image component
   - WebP format support
   - Lazy loading

3. **Caching**
   - Static assets: 1 year cache
   - HTML pages: 1 hour cache
   - API responses: based on endpoint

4. **CDN Usage**
   - Netlify CDN automatically caches assets
   - Distributed across 50+ locations globally

### Backend Optimization

1. **Database Optimization**
   - Add indexes on frequently queried columns
   - Use connection pooling (Prisma)
   - Cache frequent queries (Redis optional)

2. **API Response Optimization**
   - Pagination: max 50 items per request
   - Selective field retrieval
   - Gzip compression enabled

3. **Memory Management**
   - Monitor memory leaks with node-inspector
   - Set memory limit: `NODE_OPTIONS=--max-old-space-size=1024`

---

## SCALING & LOAD BALANCING {#scaling}

### Horizontal Scaling

When traffic increases:

1. **Backend Scaling**
   - Railway: Enable auto-scaling in settings
   - Render: Upgrade to higher tier
   - DigitalOcean: Create multiple app instances with load balancer

2. **Database Scaling**
   - Read replicas for high read traffic
   - Sharding for very large datasets
   - Connection pool optimization

3. **Frontend Scaling**
   - Netlify handles scaling automatically
   - No action needed

---

## BACKUP & DISASTER RECOVERY {#backup-recovery}

### Database Backups

```bash
# Automated daily backup
0 2 * * * /home/ubuntu/backup.sh

# Backup script
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mysqldump -u aitd_user -p'password' -h 119.18.54.49 aitd_alumni | \
  gzip > /backups/aitd_alumni_$TIMESTAMP.sql.gz

# Upload to S3
aws s3 cp /backups/aitd_alumni_$TIMESTAMP.sql.gz \
  s3://aitd-backups/database/
```

### Recovery Procedure

```bash
# 1. Download backup
aws s3 cp s3://aitd-backups/database/aitd_alumni_20240115_020000.sql.gz .

# 2. Decompress
gunzip aitd_alumni_20240115_020000.sql.gz

# 3. Restore
mysql -u aitd_user -p -h 119.18.54.49 aitd_alumni < aitd_alumni_20240115_020000.sql

# 4. Verify
mysql -u aitd_user -p -h 119.18.54.49 aitd_alumni -e "SELECT COUNT(*) FROM users;"
```

---

## POST-DEPLOYMENT MAINTENANCE {#maintenance}

### Daily Tasks
- Monitor error rates in Sentry
- Check application health endpoint
- Review error logs

### Weekly Tasks
- Review performance metrics
- Check database size growth
- Verify backup completion
- Check API response times

### Monthly Tasks
- Rotate API keys
- Update dependencies (npm update)
- Review security logs
- Check cost optimization

### Quarterly Tasks
- Security audit
- Performance optimization review
- Database optimization
- Disaster recovery drill

---

## TROUBLESHOOTING GUIDE {#troubleshooting}

### Issue: 504 Gateway Timeout

**Cause**: Backend not responding within 60 seconds
**Solution**:
1. Check backend logs for errors
2. Verify database connection
3. Check rate limiting
4. Monitor memory usage

```bash
# Check backend status
curl -v https://api.aitd.stixnvibes.com/health
```

### Issue: CORS Errors

**Cause**: Frontend URL not in `CORS_ORIGINS`
**Solution**:
1. Update `CORS_ORIGINS` environment variable
2. Redeploy backend
3. Clear browser cache

### Issue: Database Connection Failed

**Cause**: Connection string incorrect or database down
**Solution**:
```bash
# Test connection
mysql -u aitd_user -p -h 119.18.54.49 -e "SELECT 1;"

# Check connection string format
mysql://username:password@host:port/database
```

### Issue: SSL Certificate Error

**Cause**: Domain not configured or certificate expired
**Solution**:
1. Verify DNS records point to correct server
2. Check certificate expiry: `curl -vI https://aitd.stixnvibes.com`
3. Force renewal: Netlify does this automatically

### Issue: High Memory Usage

**Cause**: Memory leak or too many requests
**Solution**:
```bash
# Monitor memory
top -p $(pgrep -f "node")

# Restart service
npm restart

# Increase memory limit
NODE_OPTIONS=--max-old-space-size=2048
```

---

## API DOCUMENTATION {#api-docs}

See `API_ROUTES.md` for complete API documentation with 80+ routes.

### API Base URL
- Production: `https://api.aitd.stixnvibes.com/api`
- Development: `http://localhost:3001/api`

### Authentication
All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Rate Limits
- General API: 100 requests per 15 minutes
- Auth endpoints: 10 requests per 15 minutes
- Response header: `X-RateLimit-Remaining: 95`

### Error Format
```json
{
  "status": "error",
  "message": "User not found",
  "code": "USER_NOT_FOUND",
  "data": null
}
```

---

## DEPLOYMENT CHECKLIST

- [ ] Frontend environment variables configured in Netlify
- [ ] Backend environment variables configured in Railway/Render
- [ ] Database created and migrations run
- [ ] Domain DNS records configured
- [ ] SSL certificates verified
- [ ] Health check endpoint responding
- [ ] Test login with email/password
- [ ] Test login with Google OAuth
- [ ] Test login with LinkedIn OAuth
- [ ] Test payment processing (test mode)
- [ ] Test email notifications
- [ ] File upload to S3 working
- [ ] Error logging to Sentry working
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] Security headers present
- [ ] Database backups running
- [ ] All tests passing
- [ ] No console errors in frontend
- [ ] API response times acceptable

---

## SUMMARY

This comprehensive guide covers every aspect of deploying and maintaining the AITD Alumni Network in production. Follow each section carefully to ensure a smooth, secure, and performant deployment.

**For questions or issues, refer to the troubleshooting section or check the application logs.**
