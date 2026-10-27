# AIEM Connection — Upgrades & Fixes (for review)

> **Status:** Draft for your review. Nothing in here is applied yet.
> **How to use this:** Each item has a **Decision** tag. Tell me which to proceed with.
>
> - 🟢 **FIX-NOW** — low-risk functional fix; I can just do it (per your "rest other functional errors you can fix yourself").
> - 🟡 **NEEDS-OK** — product/visual/schema change; I want your go-ahead first.
> - 🔵 **DISCUSS** — a choice to make; I've recommended a default.
>
> Companion doc: `errors.MD` already lists functional bugs (network page crash, etc.). This doc is about **rebrand + the features you asked for + robustness/atomicity**, not a repeat of that list.

---

## 0. Overall assessment

This is a **mature, well-built full-stack app** — Next.js 14 client + Express/Prisma/PostgreSQL server, Razorpay payments, S3-or-local storage, socket.io realtime, and a large test suite. The newer "social v2" code (posts, reactions, reposts, gallery, payments) is genuinely high quality: counters are re-derived inside transactions, duplicate inserts are handled via unique constraints + P2002, and the payment/webhook path is idempotent and amount-validated.

So this is **polish and targeted hardening**, not a rewrite. The work you asked for breaks into five tracks:

1. **Rebrand** AITD Connection → **AIEM Connection** + blue/gold/white theme + landing fixes.
2. **Remove** the consumer Reels section.
3. **Add** admin-managed **College Videos** + notify.
4. **Harden** profile/banner **image upload** (it's already decent).
5. **Fix** the **Postgres atomicity** gaps (events + mentorship).

---

## 1. Rebrand: AITD Connection → AIEM Connection  🟡 NEEDS-OK (naming) / 🟢 FIX-NOW (mechanical)

**Context:** The college renamed from *Agnel Institute of Technology & Design (AITD)* to **Agnel Institute of Engineering & Management (AIEM)**, Goa. New site `aiemgoa.ac.in`, tagline **"Excellence Is Our Sole Goal."**

**Current state:** 82 user-facing "AITD" strings across 27 source files. There is **no central brand constant** — the name is hardcoded everywhere (layout title, nav, footer, legal pages, auth pages, invite copy, emails, PDF receipts).

### Plan
- **1a.** 🟡 Introduce a single brand config (`client/src/lib/brand.ts` + `server/src/config/brand.ts`) with `APP_NAME = "AIEM Connection"`, `ORG_NAME`, `TAGLINE`, support email, address, domain. Then replace the 82 hardcoded strings to read from it. **Why:** next rename is one line, not 27 files.
yes do that please
- **1b.** 🟢 Update `package.json` names (`aitd-connection` → `aiem-connection`), `<title>`/meta in `layout.tsx`, and all page `metadata`.
- **1c.** 🟡 **Placeholder contact details** still say `alumni@aitd.edu`, `privacy@aitdconnection.aitd.edu`, `legal@aitdconnection.aitd.edu`, `+91-XXXX-XXXXXX`, `[College Address]`. **I need the real email(s), phone, and address** for AIEM — otherwise I'll leave `aiem`-style placeholders.
You can get it from the webstei aiemgoa.ac.in
- **1d.** 🟢 `Education` section copy ("This is my AITD degree", "the one from AITD") → AIEM.

**Open question (🔵 DISCUSS):** Repo/folder is `aitd-alumni-network`. Renaming the Git repo/dir is disruptive (remotes, CI, Netlify). **Recommendation:** rename only the *product* strings and package names now; leave the repo folder name alone unless you specifically want it moved.
yeah yeah no worries kepe it same
---

## 2. Theme: blue / gold / white  🟡 NEEDS-OK

**Current:** primary is LinkedIn-blue `#0A66C2` (`client/tailwind.config.ts`); the hero separately uses navy `#002045` + amber. Colors are split between `tailwind.config.ts` (hardcoded hex) and `globals.css` (HSL CSS vars) — they don't fully agree, which is part of the "formatting changes" you noticed.
I dont want it look and feel like LinkedIn, if possible make ti more of aporperl what is there on the website
### Plan
- **2a.** Define one AIEM palette and wire it through **both** files so light/dark and all components agree:

  | Token | Proposed | Use |
  |---|---|---|
  | `primary` (navy) | `#0B2A5B` → hover `#14387A` | buttons, links, headers |
  | `gold` (accent) | `#C9A227` (deep gold) / `#E7C65A` (light) | highlights, badges, CTA accents |
  | `background` | `#FFFFFF` / `#F6F8FB` | page/surfaces |
  | ink | `#1A2230` | body text |
yes loooks good here thanks

  *(Exact hex is tunable — I pulled AIEM's identity as navy+gold+white; I couldn't scrape exact brand hex from `aiemgoa.ac.in`, so these are clean defaults. Say the word if you have official values.)*
- **2b.** Add `gold` as a first-class Tailwind color + a `--gold` CSS var, and make the hero gradient + "Established" pill + stat accents use the token instead of ad-hoc `amber-*` classes.

yes lplease
- **2c.** Replace the hardcoded external hero image (a `googleusercontent.com` URL — **fragile, can vanish**) with a local asset in `public/`. 🟡 *Send me a campus photo or I'll use a tasteful placeholder.*
use a placeholder for now yeah, also teh admin side we need to build I mena teh college account they maybe a frontend page builder we might have to biuld for it if required on the advanced side
---

## 3. Landing-page formatting fixes  🟢 FIX-NOW

- **3a.** Root `layout.tsx` sets `export const dynamic = 'force-dynamic'`, forcing **every** page (including the public landing + legal pages) to render dynamically — no static optimization, slower first paint. **Recommendation:** scope dynamic rendering to the authenticated `(main)` routes that need it, let marketing/legal pages be static.
- **3b.** Font mismatch: `tailwind.config.ts` declares headline font **Newsreader**, but `layout.tsx` actually loads **Playfair Display**. Harmless but confusing — align them.
- **3c.** Hardcoded hero stats ("24k+ Global Alumni", "850 Active Careers", "120 Annual Events") are invented numbers. 🔵 **DISCUSS:** wire them to the real `/users/stats` endpoint (already exists) or keep them as static marketing copy? I recommend wiring the ones we have real data for.
yes do that as you recommend
---

## 4. Remove the Reels section  🟡 NEEDS-OK

You said drop Reels but keep "admin add college videos." The video **upload/storage infra stays** (it'll back College Videos); only the consumer Reels surface goes.
soo remove the word reels, and add Videos and then admin can add all college stuff and even alumns or students can submit it and then admin can approve it if rqreuired
### Surface to remove (fully mapped)
| Layer | Location |
|---|---|
| Nav links | `components/layout/MainNav.tsx:51`, `app/(main)/dashboard/page.tsx:83` |
| Page | `app/(main)/reels/page.tsx` (whole route) |
| Component | `components/social/ReelsViewer.tsx` (+ its test) |
| Composer toggle | `components/social/PostComposer.tsx` (reel mode, `isReel` checkbox, "Post as a reel") |
| Profile tab | `components/social/ProfileSocial.tsx` (reels tab) |
| API client | `lib/social.ts` `reels()` + `userPosts({reels})` |
| Server route | `routes/index.ts:168` `GET /reels` |
| Server feed | `feedService.getReels` + `isReel` filters |

🔵 **DISCUSS — the `Post.isReel` column & existing reel posts:** I recommend **keeping the `isReel` DB column** (stop writing/reading it from the UI, leave data intact) rather than a destructive migration. If you want it gone entirely, that's a separate migration + backfill decision. Any existing reel posts would just render as normal video posts.
do what I have mentioend thanks
---

## 5. New feature: Admin College Videos + notify  🟡 NEEDS-OK

Nothing like this exists yet (closest patterns: admin-managed Gallery albums and News articles). Proposed design, modeled on the existing gallery/news admin flow:
yes pelase 
add kafka for notificaiton and all that and build a new prisma model yes 
### Data model (new Prisma model)
```prisma
model CollegeVideo {
  id          String   @id @default(uuid())
  title       String
  description String?  @db.Text
  videoUrl    String             // reuses existing storeVideo() pipeline
  thumbnailUrl String?
  category    String?            // e.g. Campus, Convocation, Lectures
  isPublished Boolean  @default(true)
  viewCount   Int      @default(0)
  uploadedById String
  uploadedBy  User     @relation(fields: [uploadedById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([isPublished, createdAt])
}
```

### API (admin-gated, mirrors `/news`)
- `GET /college-videos` (public list), `GET /college-videos/:id`
- `POST /college-videos` (admin; multipart video via existing `videoUpload`)
- `PATCH /college-videos/:id`, `DELETE /college-videos/:id` (admin)

### Client
- Public page `/videos` (card grid + player), admin management in `app/(main)/admin/`.

### "Notify" on publish  🔵 DISCUSS
There's **no broadcast helper today** — `notificationService.createNotification` is one-user-at-a-time, and a loop over all alumni doesn't scale. Options:
- **(A, recommended)** Add a batched `notifyAll()` using `createMany` (chunked) that emits an `ADMIN_ANNOUNCEMENT` notification — the enum value already exists. Fine up to tens of thousands of users.
- **(B)** Notify only opted-in / active users, or per-chapter.
- **(C)** Email digest instead of in-app.
yes (A) what you have mentioned thanks
also can mention college magazine and stuff

Tell me which, and whether a new video should notify **everyone** or be opt-in.

---

## 6. Image upload hardening  🟢 FIX-NOW (small) / 🟡 NEEDS-OK (cropping)

Current state is **already good**: client preview + size/type validation + 5 MB cap; server re-encodes via Sharp, strips to safe formats, path-traversal-safe deletes, S3-or-local. Improvements for a "ready platform":
yes make it ready and not stretched away please thank you

- **6a.** 🟢 **WebP inconsistency (real bug):** the server optimizer fully supports WebP, but the multer `fileFilter` (`storage.ts` `IMAGE_TYPES`) **and** client `PHOTO_ACCEPT` (`lib/profile.ts`) reject it. So a `.webp` upload is refused even though we'd handle it fine. Add `image/webp` to both.
- **6b.** 🟢 GIF is accepted but **not** compressed — a 5 MB animated GIF is stored as-is. Either cap GIF dimensions or document it. Minor.
- **6c.** 🟡 **Banner/cover cropping:** today the cover is a free-form upload shown with `object-cover` — users can't control framing. For a polished profile, add a lightweight client-side crop (fixed ~3:1 for banner, 1:1 for avatar) before upload. Needs a small library decision. OK given
- **6d.** 🟢 Cover preview uses a raw `<img>`; fine for blob previews but worth a comment/consistency pass.
- **6e.** 🔵 **DISCUSS — "put up my firms and business":** you mentioned showcasing your firms/businesses. The **Marketplace** model (`MarketplaceListing`: BUSINESS/SERVICE/REQUIREMENT) already exists but has **no image/logo field**. For a credible business showcase we'd want a `logoUrl`/`images` field + upload. Want me to extend Marketplace, or is this a separate "Business Profile" concept?
yes and also the globe where people are working or they can add their location proiortu given to work location and then residence okay so put that up also, no extend marketplace, and also make a section like Founders that iwll be under market place only

---

## 7. PostgreSQL atomicity  🟢 FIX-NOW

Full audit done. **Good news:** all money paths (Razorpay order → verify → webhook) and all Post/Chapter/Gallery counters are correctly transactional and idempotent. No HIGH-severity drifts. The real gaps:

| # | Severity | Location | Problem | Fix |
|---|---|---|---|---|
| 7a | **Med** | `eventService.ts:386-396` | **RSVP overbooking.** Capacity check reads a stale row *outside* the transaction; two concurrent RSVPs on the last seat both pass → `rsvpCount > capacity`. `@@unique([eventId,userId])` only stops the *same* user double-booking. | Move the capacity check inside the tx and guard the increment (conditional `updateMany`), or re-derive count in-tx. |
| 7b | **Med** | `mentorshipService.ts:406-419` | **`currentMentees` double-count / overbook.** `respondToRequest` sets status ACCEPTED *unconditionally* in-tx and always increments. Double-click or concurrent accepts drift the counter above reality / past `maxMentees`. | Use the status-guarded `updateMany(where status='PENDING')` claim pattern (the exact pattern payments already use) to gate the increment. |
| 7c | **Med** | `mentorshipService.ts:600-610` | **`currentMentees` double-decrement.** `endMentorship` sets COMPLETED unconditionally; both mentor and mentee ending concurrently both decrement. | Same status-guarded claim: only decrement if *this* call did the ACCEPTED→COMPLETED transition. |
| 7d | **Low** | `mentorshipService.ts:322-337` | **Duplicate mentorship requests.** Check-then-insert with no unique constraint → two concurrent requests from same mentee→mentor both insert. | Add `@@unique` (and/or catch P2002). |
| 7e | **Low** | `postService.ts:295-298` | View impression insert + `viewCount` increment are two statements; a crash between them permanently under-counts by 1 (impression blocks future increment). | Wrap both in one `$transaction`. |
| 7f | **Low** | `chapterService.ts:308-315` | `assignAdmin` writes `chapter.adminUserId` then `user.role` outside a tx — partial state if the 2nd fails. Also never demotes the old admin. | Wrap in `$transaction`; decide on demotion. |
| 7g | **Low** | `eventService.ts:369-396` | RSVP *toggle* reads existing row outside tx; concurrent toggles throw P2025/P2002 surfaced as generic 404/409. No drift, cosmetic. | Re-check in-tx. |

**Design note (not a live bug):** there is **no refund flow** anywhere — `Transaction` status is never set to `REFUNDED`, and `Chapter.totalDonations` is never reversed. Fine today; flag it if refunds are ever added.

**Recommendation:** 7a/7b/7c are worth doing — they violate real business constraints (seats, mentee caps) under ordinary concurrency. All are self-contained, test-covered areas.

---

## 8. Other robustness / "done better" notes

- **8a.** 🟢 Hardcoded external hero image (see 3c/2c) — single point of failure on the landing page.
- **8b.** 🔵 No central config for the many invented marketing numbers / copy — minor. might need that 
- **8c.** 🟢 `pdfReceipt.ts` and emails carry `aitd.edu` + `+91-XXXX` placeholders — real contact info needed (ties to 1c).
- **8d.** 🔵 `force-dynamic` globally (see 3a) also means no CDN caching of public pages — worth fixing for SEO/perf of a public alumni site. yes
- **8e.** 🔵 Broadcast notifications (see 5) will need batching before any "notify all" feature ships. yes

---

## 9. Suggested order of execution

**Phase 1 — safe fixes I can start immediately (🟢):** 1b, 1d, 3a, 3b, 6a, 6b, 7a–7g, 8a/8c placeholders.
**Phase 2 — needs your OK (🟡):** 1a brand constant + full rename, 2a–2c theme, 4 reels removal, 5 college videos, 6c cropping.
**Phase 3 — your decisions (🔵):** repo rename, hero stats source, `isReel` column fate, notify strategy, marketplace-vs-business-profile, marketing copy.

### What I need from you to move fast
1. Real AIEM **contact email / phone / address** (for 1c, 8c).
2. Confirm the **palette hex** (or send official AIEM brand colors).
3. A **campus hero image** (or I use a placeholder).
4. **Notify strategy** for college videos (6 → A/B/C).
5. **Business showcase**: extend Marketplace or new Business Profile? (6e)
6. Green-light which 🟡 items to build.

---
*Generated during code inspection on 2026-10-27. Line numbers reference the tree at that time.*
