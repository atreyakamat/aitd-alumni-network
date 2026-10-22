# System-Wide Error & Defect Audit (ERRORS.MD)

> **Document Status**: Complete & Verified  
> **Audited Services**: Network & Connections, Search, Messages & Real-Time Chat, Jobs & Careers, Mentorship, Authentication & OAuth, Directory, Donations & Razorpay Payments.

---

## 1. Network & Connections Service

### Error 1.1: Runtime `TypeError` in "Connections" Tab Crash
* **Severity**: Critical (High Impact - Page Crash)
* **Affected Files**: `client/src/app/(main)/network/page.tsx`, `server/src/services/networkService.ts`
* **Root Cause**:
  In `network/page.tsx`:
  ```tsx
  const partner = conn.requesterId === conn.userId ? conn.addressee : conn.requester;
  ```
  1. `conn.userId` does not exist on the Prisma `Connection` model.
  2. `networkService.getConnections` already maps connections into flattened `connectedUsers` objects (`{ connectionId, id, fullName, profilePhotoUrl, ... }`).
  3. Because `conn` is the user object, `conn.requesterId` and `conn.requester` are `undefined`. Consequently, `partner` evaluates to `undefined`, and accessing `partner.id`, `partner.fullName`, or `partner.profilePhotoUrl` throws `TypeError: Cannot read properties of undefined (reading 'id')`, crashing the entire page as soon as a user has any connections.
* **Proposed Fix**:
  Normalize `partner`:
  ```tsx
  const partner = conn.id ? conn : (conn.requesterId === user?.id ? conn.addressee : conn.requester);
  const partnerId = partner?.id || conn.id;
  const key = conn.connectionId || conn.id;
  ```

---

### Error 1.2: Missing Batch Year & Department Fields in Connections
* **Severity**: Medium (Data Integrity & UI Flaw)
* **Affected Files**: `server/src/services/networkService.ts`, `client/src/app/(main)/network/page.tsx`
* **Root Cause**:
  In `networkService.ts` line 24-44, the query selects for `requester` and `addressee` did not include `batchYear` or `department`. The UI attempted to display `Class of {partner.batchYear} • {partner.department}`, rendering `Class of undefined • undefined`.
* **Proposed Fix**:
  Add `batchYear: true` and `department: true` to the Prisma selects for both `requester` and `addressee` in `getConnections()`.

---

### Error 1.3: "Requests" Tab Completely Broken & Missing Pending Requests
* **Severity**: High (Feature Broken)
* **Affected Files**: `client/src/app/(main)/network/page.tsx`, `server/src/services/networkService.ts`
* **Root Cause**:
  `networkService.getPendingRequests` returns an object `{ received: [...], sent: [...] }`. In `network/page.tsx`, `setRequests(reqRes.data.data || [])` sets state to this object. `requests.length` is `undefined`, so:
  1. The Requests badge is never shown (`undefined > 0` is false).
  2. Pending requests are never displayed.
  3. The received items inside the server response are shaped as `{ connectionId, user, createdAt }`, but the template attempted to access `req.requester.id`, which does not exist.
* **Proposed Fix**:
  Extract received requests correctly:
  ```tsx
  const received = reqRes.data.data?.received || (Array.isArray(reqRes.data.data) ? reqRes.data.data : []);
  setRequests(received);
  ```
  And in the render loop, safely access `req.user || req.requester` and `req.connectionId || req.id`.

---

## 2. Global Search Service

### Error 2.1: Missing Implementation for Search Tabs (Jobs, Events, Posts)
* **Severity**: High (Incomplete Feature / Dead UI)
* **Affected Files**: `client/src/app/(main)/search/page.tsx`
* **Root Cause**:
  Line 258 of `search/page.tsx` contained an unfinished placeholder comment:
  ```tsx
  {/* ... other TabsContent for jobs, events, posts ... */}
  ```
  `TabsTrigger` buttons existed for `jobs`, `events`, and `posts`, but there was zero `TabsContent` implemented for them. Clicking any of those tabs rendered blank space.
* **Proposed Fix**:
  Implement dedicated `TabsContent` for:
  - `jobs`: listing matching job cards with title, company, type, location, and link to `/jobs/:id`.
  - `events`: listing matching event cards with date badge, location, title, and link to `/events/:id`.
  - `posts`: listing matching posts with author info, content snippet, and link to `/posts/:id`.

---

### Error 2.2: Uncontrolled `<Tabs>` Component Blocks "View All" Navigation
* **Severity**: Medium (Broken Interaction)
* **Affected Files**: `client/src/app/(main)/search/page.tsx`
* **Root Cause**:
  `<Tabs defaultValue="all">` was rendered without `value={activeTab}` and `onValueChange={setActiveTab}`. When users clicked "View all" under People, Jobs, or Events (`setActiveTab('users')`), the React state updated but the tab component did not switch because it was uncontrolled.
* **Proposed Fix**:
  Add `value={activeTab} onValueChange={setActiveTab}` to `<Tabs>`.

---

## 3. Messages & Real-Time Chat Service

### Error 3.1: Initiating Chat via Deep Link (`/messages?u=targetUserId`) Fails
* **Severity**: High (Core User Flow Broken)
* **Affected Files**: `client/src/app/(main)/messages/page.tsx`
* **Root Cause**:
  In `messages/page.tsx`:
  ```tsx
  if (existing) {
    setActiveConversation(existing);
  } else {
    // Fetch specific user profile to start new conversation
    // For simplicity, we just wait for them to show up or handle specially
  }
  ```
  When a user clicked "Message" on another member's profile, job posting, or event organizer (`/messages?u=targetUserId`) with whom they did not already have prior messages, `activeConversation` was left `null`. The user was shown "Select a conversation from the left", with no conversation to select.
* **Proposed Fix**:
  When `targetUserId` is not in `conversations`, fetch the target user's profile with `userApi.getProfile(targetUserId)` and create a new active conversation placeholder so the user can send their first message.

---

### Error 3.2: Malformed CSS Height Expression
* **Severity**: Low (CSS Warning)
* **Affected Files**: `client/src/app/(main)/messages/page.tsx`
* **Root Cause**:
  Line 118: `className="flex h-[calc(100-200px)] items-center justify-center"`. Missing units in CSS calculation causes parser failure.
* **Proposed Fix**:
  Update to `h-[calc(100vh-120px)]`.

---

### Error 3.3: Chat Page Does Not Listen to Socket Incoming Messages
* **Severity**: High (Real-Time Functionality Missing)
* **Affected Files**: `client/src/app/(main)/messages/page.tsx`
* **Root Cause**:
  `messages/page.tsx` only checked `useSocketContext().isConnected`. It never listened for `socket:new_message` events, so new messages sent by the conversation partner did not appear until the page was reloaded.
* **Proposed Fix**:
  Add `useSocketEvent<any>('socket:new_message', (msg) => ...)` to append incoming messages and mark them as read if the active conversation matches.

---

## 4. Jobs & Careers Service

### Error 4.1: Poster Batch Year & Department Undefined in Job Details
* **Severity**: Medium (Data Integrity / UI Flaw)
* **Affected Files**: `server/src/services/jobService.ts`, `client/src/app/(main)/jobs/[id]/page.tsx`
* **Root Cause**:
  `jobService.ts` defined `posterSelect` as `{ id, fullName, profilePhotoUrl, currentDesignation }`, omitting `batchYear` and `department`. In `jobs/[id]/page.tsx`, it displayed `Class of {job.postedBy.batchYear} • {job.postedBy.department}`, rendering `Class of undefined • undefined`.
* **Proposed Fix**:
  Add `batchYear: true, department: true` to `posterSelect` in `jobService.ts`, and guard accesses in `jobs/[id]/page.tsx`.

---

### Error 4.2: Invalid DOM Nesting: `<button>` Inside `<a>`
* **Severity**: Medium (HTML Validity & React Warning)
* **Affected Files**: `client/src/app/(main)/jobs/page.tsx`
* **Root Cause**:
  Lines 244-248 wrapped `<Button>` inside `<Link>` without `asChild`, producing `<a><button>...</button></a>`.
* **Proposed Fix**:
  Use `<Button asChild><Link href="...">...</Link></Button>`.

---

### Error 4.3: Unhandled Null Poster in Job Details
* **Severity**: Medium (Potential Runtime TypeError)
* **Affected Files**: `client/src/app/(main)/jobs/[id]/page.tsx`
* **Root Cause**:
  Direct property accesses `job.postedBy.id` on line 242 and 253 without optional chaining.
* **Proposed Fix**:
  Use `job.postedBy?.id` with fallback UI if the poster has deleted their account.

---

## 5. Mentorship Service

### Error 5.1: Missing Form Wrapper Prevents Search on "Enter" Key
* **Severity**: Medium (UX Defect)
* **Affected Files**: `client/src/app/(main)/mentorship/page.tsx`
* **Root Cause**:
  Search and filter inputs in the "Find a Mentor" tab were contained in a `<div>` without a `<form onSubmit={...}>`. Pressing Enter in the input did nothing.
* **Proposed Fix**:
  Wrap the search controls in a `<form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>`.

---

### Error 5.2: Unsafe Initials Extraction Causing Crashes
* **Severity**: Medium (Potential Runtime TypeError)
* **Affected Files**: `client/src/app/(main)/mentorship/page.tsx`
* **Root Cause**:
  Lines 354, 427, and 487 used `fullName.split(' ').map(...)` directly. If `fullName` was empty or missing, `TypeError: Cannot read properties of undefined (reading 'split')` was thrown.
* **Proposed Fix**:
  Import and use `getInitials(name)` from `@/lib/utils`.

---

## 6. Authentication & OAuth Service

### Error 6.1: OAuth One-Time Code Exchange Double-Submission Race Condition
* **Severity**: High (Intermittent Auth Failure)
* **Affected Files**: `client/src/app/(auth)/login/page.tsx`
* **Root Cause**:
  In React 18 / Next.js 14, `useEffect` can fire multiple times on mount. If `code` was present, the one-time exchange API `/auth/oauth/exchange` was invoked concurrently or consecutively. Because the backend marks the token as used, the second invocation failed with `INVALID_CODE`, triggering a destructive "Login Failed" toast even though the user had logged in.
* **Proposed Fix**:
  Add an `exchangedRef = useRef(false)` guard to ensure the exchange request is made strictly once.

---

### Error 6.2: Ignored `?redirect=` Query Parameter
* **Severity**: Medium (Navigation Inconsistency)
* **Affected Files**: `client/src/app/(auth)/login/page.tsx`
* **Root Cause**:
  `login/page.tsx` only inspected `searchParams?.get('next')`. Deep links and components redirecting to `/login?redirect=...` were ignored, directing users to `/dashboard` instead of their intended page.
* **Proposed Fix**:
  Check `searchParams?.get('next') ?? searchParams?.get('redirect')`.

---

## 7. Directory Service

### Error 7.1: `useEffect` Infinite/Redundant Re-render Trigger on Connections
* **Severity**: Medium (Performance & Re-render Loop)
* **Affected Files**: `client/src/app/(main)/directory/page.tsx`
* **Root Cause**:
  `const connections = connectionsData?.items || [];` created a new array reference on every render when `connectionsData?.items` was undefined. In `useEffect([user, connections])`, this triggered unnecessary effect runs on every render.
* **Proposed Fix**:
  Depend on `connectionsData?.items` directly: `useEffect(..., [user, connectionsData?.items])`.

---

### Error 7.2: Silent Failure on Connection Request
* **Severity**: Medium (Silent Error / Poor UX)
* **Affected Files**: `client/src/app/(main)/directory/page.tsx`
* **Root Cause**:
  `handleConnect` only logged `console.error` on failure without showing a toast. If a request failed (e.g., already connected or limit reached), the user was left in the dark.
* **Proposed Fix**:
  Show a destructive toast using `getApiErrorMessage(error)`.

---

## 8. Donations Service

### Error 8.1: Inert "Search Donors" Input on Donor Wall
* **Severity**: Low (Unwired UI Element)
* **Affected Files**: `client/src/app/(main)/donations/page.tsx`
* **Root Cause**:
  `<Input placeholder="Search donors..." className="pl-9 w-64" />` had no value, state, or change handler.
* **Proposed Fix**:
  Add search state and filter the displayed donors list by donor name, message, or chapter.

---

### Error 8.2: Inconsistent Initials Generator
* **Severity**: Low (Code Quality & Edge Cases)
* **Affected Files**: `client/src/app/(main)/donations/page.tsx`
* **Root Cause**:
  Local un-guarded `getInitials` implementation returned `'UN'` on empty strings.
* **Proposed Fix**:
  Use the centralized `getInitials` from `@/lib/utils`.
