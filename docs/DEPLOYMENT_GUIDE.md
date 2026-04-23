# Deployment Guide

## Issue: ERR_NAME_NOT_RESOLVED on Production

If you're seeing `ERR_NAME_NOT_RESOLVED` errors when trying to register/login on production, it means the frontend is trying to reach an API endpoint that doesn't exist.

### Root Cause

The frontend needs to know where your backend API is deployed. Without explicit configuration, it defaults to same-origin `/api` calls. If that endpoint doesn't exist, requests fail.

### Solution: Configure Your Deployment

Choose one of the three deployment patterns below and configure accordingly.

---

## Deployment Patterns

### Pattern 1: Separate Backend Domain (Most Common for Netlify)

**Best for:** Backend deployed on Heroku, Railway, AWS Lambda, Render, or any other platform.

**Frontend on Netlify, Backend elsewhere:**

1. **Get your backend URL:**
   - Backend deployed to: `https://my-backend-api.herokuapp.com` (or similar)

2. **Set Netlify environment variable:**
   ```
   NEXT_PUBLIC_API_URL=https://my-backend-api.herokuapp.com/api
   ```

   Steps:
   - Go to Netlify dashboard → Site settings → Environment
   - Add: `NEXT_PUBLIC_API_URL` = `https://your-backend-url/api`
   - Trigger a new deploy

3. **Verify:** After deploy, registration/login should work.

---

### Pattern 2: Same Domain with Reverse Proxy

**Best for:** Frontend and backend on same domain (e.g., both on aitd.stixnvibes.com)

**Requirements:** Reverse proxy (Nginx, Apache, or similar) that routes `/api/*` to backend.

1. **Frontend defaults to same-origin:**
   ```
   # No NEXT_PUBLIC_API_URL needed (uses /api by default)
   ```

2. **Proxy configuration example (Nginx):**
   ```nginx
   location /api {
     proxy_pass http://backend-server:5000/api;
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
   }
   ```

3. **Verify:** After setup, registration/login should work.

---

### Pattern 3: Netlify Functions (Monolithic)

**Best for:** Using Netlify Functions as backend.

1. **Frontend defaults to same-origin:**
   ```
   # No NEXT_PUBLIC_API_URL needed (uses /api by default)
   ```

2. **Configure Netlify to route `/api/*` to Functions:**
   ```toml
   # netlify.toml
   [[redirects]]
     from = "/api/*"
     to = "/.netlify/functions/:splat"
     status = 200
   ```

3. **Deploy your Functions** at `.netlify/functions/auth/register`, etc.

4. **Verify:** After deploy, registration/login should work.

---

## Testing Your Deployment

### 1. Check API Endpoint

Open browser console and run:
```javascript
const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
console.log('API Base URL:', apiUrl);
```

If `NEXT_PUBLIC_API_URL` shows correct backend URL, that's good.
If it shows `/api`, verify your reverse proxy/Functions are working.

### 2. Test Register Endpoint

Make a test request from browser console:
```javascript
fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@example.com',
    password: 'Test@123',
    firstName: 'Test'
  })
}).then(r => r.json()).then(console.log).catch(console.error);
```

**Expected responses:**
- ✅ Success: `{"user": {...}, "accessToken": "..."}`
- ❌ Error 404: `/api/*` endpoint doesn't exist → check deployment config
- ❌ Error 502/503: Backend not reachable → check backend URL and connectivity
- ❌ `ERR_NAME_NOT_RESOLVED`: DNS record doesn't exist → check backend hostname

### 3. Check Network Tab

Open DevTools → Network tab → Try registering:
- Look for POST to `/api/auth/register` (or `https://your-backend/api/auth/register`)
- Check Response Status (should be 200 or 400 for validation error, not 404/502)
- If 404, endpoint doesn't exist
- If 502, backend is down

---

## Troubleshooting

### Problem: "404 Not Found" on /api/auth/register

**Possible causes:**
1. Backend not deployed where frontend expects it
2. `/api/auth/register` endpoint doesn't exist

**Fix:**
```bash
# 1. Verify backend is running locally
cd server && npm run dev
# Should show: Backend running on port 5000
# Test: curl http://localhost:5000/api/auth/register

# 2. If using separate domain, verify it's correct
echo $NEXT_PUBLIC_API_URL

# 3. If using same domain, check reverse proxy config
# Verify /api/* routes to backend
```

### Problem: "ERR_NAME_NOT_RESOLVED" or "Failed to resolve DNS"

**Cause:** Frontend trying to reach non-existent domain.

**Fix:**
1. Check what URL frontend is trying to reach (see Network tab)
2. Ensure that domain/URL exists and has a DNS record
3. Or change `NEXT_PUBLIC_API_URL` to correct URL

### Problem: "502 Bad Gateway"

**Cause:** Reverse proxy can't reach backend, or backend is down.

**Fix:**
```bash
# 1. Verify backend is running
ps aux | grep "node\|express\|npm"

# 2. Check backend logs
# Look for startup errors, DB connection issues, etc.

# 3. Verify reverse proxy target is correct
# If proxy points to http://localhost:5000 but backend is elsewhere, it will fail
```

---

## Checklist for Production

- [ ] Backend is deployed and accessible
- [ ] `NEXT_PUBLIC_API_URL` is set correctly (or defaults to `/api` with proxy configured)
- [ ] Frontend build includes correct API URL
- [ ] Reverse proxy/Functions route `/api/*` to backend (if using same domain)
- [ ] Backend health check passes: `curl https://your-backend/health`
- [ ] Registration/login work on production
- [ ] Admin account seeded: admin@aitdconnection.edu / Admin@123

---

## Quick Reference

| Deployment | Frontend Config | Backend Location |
|---|---|---|
| Netlify + Heroku | `NEXT_PUBLIC_API_URL=https://api.herokuapp.com/api` | Heroku |
| Netlify + AWS | `NEXT_PUBLIC_API_URL=https://api.example.com/api` | AWS |
| Same domain + Nginx | No config (uses `/api`) | Same server behind Nginx |
| Same domain + Functions | No config (uses `/api`) | Netlify Functions |

---

## For the AITD Project

Based on your setup (`aitd.stixnvibes.com`):

**Current Status:**
- Frontend: Netlify (aitd.stixnvibes.com)
- Backend: NOT CONFIGURED - causing DNS errors

**To Fix:**

**Option A: Deploy backend to separate domain**
1. Deploy backend to Heroku, Railway, AWS, or similar
2. In Netlify: Set `NEXT_PUBLIC_API_URL=https://your-backend-url/api`
3. Redeploy frontend

**Option B: Host backend on same server**
1. Deploy Express backend to same server as frontend
2. Use Nginx to route `/api/*` → backend:5000
3. No frontend config needed
4. Redeploy frontend

**For now, I recommend Option A** (separate backend platform) as it's simpler and more scalable.
