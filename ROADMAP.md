# AIEM Connection — Next Build Roadmap

> **Status:** Proposal for your review. Annotate inline (like `upgradstofix.md`) — tell me which to build, tweak scope, or drop.
> **Scope chosen by you:** weekly digest email (admin), job referrals, admin/college jobs, a college requirements board, and a landing-page builder. **No AI features** (intentionally skipped).
>
> Effort key: **S** ≈ 1–2 days · **M** ≈ 3–6 days · **L** ≈ 1–3 weeks. Most of these reuse infrastructure the platform already has (email, BullMQ queue, notifications, jobs, admin gating), so they're faster than they look.

---

## Suggested order

1. **Admin/College jobs** (S) — tiny, high visibility, unblocks the careers story.
2. **College Requirements Board** (M) — reuses the submit→review pattern we just built for videos.
3. **Job referral requests** (M) — the career outcome that makes alumni stay.
4. **Weekly digest email** (M) — biggest retention lever; uses the BullMQ queue we added.
5. **Landing-page builder** (L) — the largest piece; ship a small block set first.

---

## 1. Admin / College-level Jobs  🟢 small

**What:** Today members post jobs that go through review (`JobStatus: DRAFT → PENDING_REVIEW → PUBLISHED`). Add **official jobs** posted by the college/placement cell that publish immediately and carry an "Official — AIEM Placement Cell" badge, optionally pinned to the top of the board.

**Uses what exists:** the whole jobs module + admin gating. This is mostly a flag + a badge + a filter.

**Data model:** `JobOpportunity` gains `isOfficial Boolean @default(false)` (+ reuse existing `isFeatured` for pinning).

**Surface:** admin "Post official job" action (auto-`PUBLISHED`, `isOfficial = true`); job cards show the badge; a "Placement Cell" filter on the jobs page.

**Decisions for you:**
- Badge wording: "Official" / "Placement Cell" / "AIEM Verified"?
- Should official jobs always pin above member jobs?

---

## 2. College Requirements Board  🟡 medium

**What:** The college posts **requirements** ("we need X hardware / software / expertise / sponsorship"); any alum can **respond offering to provide or help**. Admin reviews offers and marks a requirement fulfilled. It mirrors the alumni→admin flow, but reversed (college→alumni).

**Uses what exists:** the exact submit → notify → review pattern from College Videos, plus notifications and admin gating.

**Data model (new):**
```prisma
enum RequirementCategory { HARDWARE SOFTWARE EXPERTISE SPONSORSHIP OTHER }
enum RequirementStatus   { OPEN FULFILLED CLOSED }

model CollegeRequirement {
  id          String  @id @default(uuid())
  title       String
  description String  @db.Text
  category    RequirementCategory @default(OTHER)
  status      RequirementStatus   @default(OPEN)
  postedById  String              // admin
  createdAt   DateTime @default(now())
  responses   RequirementResponse[]
}

model RequirementResponse {
  id            String  @id @default(uuid())
  requirementId String
  userId        String              // the offering alum
  message       String  @db.Text
  status        String  @default("OFFERED") // OFFERED, ACCEPTED, DECLINED
  createdAt     DateTime @default(now())
  @@unique([requirementId, userId]) // one offer per alum per requirement
}
```

**Surface:**
- Public page `/requirements` — open requirements with an "I can help" button → opens a response form.
- Admin `/admin/requirements` — create/edit/close requirements, see & accept/decline offers.
- Notifications: new requirement → broadcast to alumni (reuse the BullMQ broadcast); new offer → notify admins; offer accepted → notify the alum.

**Decisions for you:**
- Categories above OK? (added SPONSORSHIP — common ask; drop if not wanted.)
- Should offers be private to admins, or visible to other alumni (social proof)?
- Broadcast every new requirement to everyone, or only show on the page?

---

## 3. Job Referral Requests  🟡 medium

**What:** A member viewing a job (or an alum who works at a company) can **request a referral**. The target alum is notified and can accept (→ opens a conversation) or decline. This turns the directory + jobs + messaging you already have into real outcomes — it's the single most valuable alumni-network mechanic.

**Uses what exists:** jobs, `WorkExperience.company` (to find alumni at a company), messaging, notifications.

**Data model (new):**
```prisma
enum ReferralStatus { PENDING ACCEPTED DECLINED }

model ReferralRequest {
  id          String @id @default(uuid())
  requesterId String             // alum seeking the referral
  targetId    String             // alum who can refer
  jobId       String?            // optional: a specific job on the board
  company     String             // the company being targeted
  message     String  @db.Text
  status      ReferralStatus @default(PENDING)
  createdAt   DateTime @default(now())
  @@index([targetId, status])
  @@unique([requesterId, targetId, jobId]) // no duplicate asks
}
```

**Surface:**
- On a job detail: "Ask for a referral" → shows alumni who work at that company (from `WorkExperience`), pick one, write a note.
- On a profile: "Request a referral" if they work somewhere relevant.
- Recipient gets a notification + an inbox of referral asks to accept/decline; accepting links to the conversation.

**Decisions for you:**
- Rate-limit asks (e.g. max N pending per member) to prevent spam?
- Only connections can ask, or anyone? (Recommend: anyone, but capped.)

---

## 4. Weekly Digest Email (admin-controlled)  🟡 medium

**What:** A scheduled weekly email per member — "near you: 3 alumni · 2 new jobs · 1 event · new video" — fully controlled from the admin side: turn on/off, pick the day/time, choose which sections, send a test, and send-now. This is the biggest *return-to-the-platform* lever and needs no one to open the app.

**Uses what exists:** the email layer (nodemailer), the **BullMQ queue we just added** (a repeatable job for scheduling), stats, events, jobs, videos, notifications, and the alumni-nearby data.

**Data model (new):**
```prisma
model DigestSettings {   // single row the admin edits
  id         String  @id @default("default")
  enabled    Boolean @default(false)
  dayOfWeek  Int     @default(1)   // 1 = Monday
  hour       Int     @default(9)   // 09:00 server time
  sections   Json                   // which blocks to include
  updatedAt  DateTime @updatedAt
}
// + User.digestOptOut Boolean @default(false)  (members can unsubscribe)
```

**Surface:**
- Admin `/admin/communications` — toggle, schedule, section checkboxes, **Preview** and **Send test to me**.
- BullMQ repeatable job builds each member's personalized digest and sends in batches (same fan-out style as broadcasts).
- One-click unsubscribe link in the footer (sets `digestOptOut`).

**Decisions for you:**
- Default cadence — weekly Monday 9am?
- **Opt-out** (everyone gets it unless they unsubscribe) vs **opt-in** (only those who choose). Opt-out drives far more engagement but be mindful of email etiquette; recommend opt-out with a clear unsubscribe.
- Which sections in v1: nearby alumni · new jobs · upcoming events · new videos · new requirements?

---

## 5. Landing-Page Builder  🟠 large (start small)

**What:** Let the college admin compose the public landing page themselves. You weighed "raw HTML/CSS" vs "visual element builder" — the best answer is **both in one**: a **block builder with a small set of ready-made elements, plus a "Custom HTML/CSS" block** as a power-user escape hatch. Start with a few blocks and grow.

**Data model (new):**
```prisma
enum LandingBlockType { HERO TEXT IMAGE STATS CARDS CTA GALLERY VIDEO HTML }

model LandingBlock {
  id          String @id @default(uuid())
  type        LandingBlockType
  config      Json              // per-type fields (title, body, imageUrl, items[], or raw html/css)
  order       Int    @default(0)
  isPublished Boolean @default(true)
  updatedAt   DateTime @updatedAt
  @@index([isPublished, order])
}
```

**How it works:**
- **Admin editor** `/admin/landing` — add/reorder/delete blocks, edit each block's fields, toggle publish, live preview. Each block type is a small React component + a small form.
- **Public landing** renders published blocks in order (the current hero/stats/features become the default seed blocks, so nothing is lost).
- **v1 block set (recommended):** `HERO`, `TEXT`, `IMAGE`, `STATS` (wired to real `/users/stats`), `CTA`, and **`HTML`** (raw code). Add `CARDS`/`GALLERY`/`VIDEO` later.

**The two options you mentioned, and how they fit:**
- **Raw HTML/CSS block** — maximum flexibility, fastest to build, but admin-authored HTML rendered to all visitors is an **XSS risk**. We render it in a **sandboxed `<iframe>`** (or strict sanitization) so a bad paste can't hijack visitor sessions. This is the `HTML` block above.
- **Visual element builder** — safer and friendlier (forms, no code), but more components to build. This is the rest of the block types.
- **Recommendation:** build the element builder with the `HTML` block included — you get both, and most pages never need raw code.

**Effort:** `HTML`-block-only = **S–M**; full element builder = **L**. I'd ship ~5 blocks + HTML first (**M–L**), then add block types on demand.

**Decisions for you:**
- v1 block set — the 6 above, or a different mix?
- For the HTML block: sandboxed iframe (safest) vs sanitized inline — recommend **sandboxed iframe**.
- Per-page scope: just the landing page in v1, or multiple pages (About / per-chapter) later?

---

## Intentionally skipped
- **AI features** — you opted out; noted. (The hooks exist if you ever change your mind: matchmaking, intro-writer, moderation assist.)

---

## What I need from you to start
Tell me which item(s) to build and resolve the **Decisions for you** under each (or just say "your recommended defaults"). I'll scope the chosen one precisely, then build it in verified increments like the rest of this work.

*Written 2026-10-28. Each feature reuses existing modules noted above; DB changes ship as Prisma migrations you apply with `npm run db:migrate`.*
