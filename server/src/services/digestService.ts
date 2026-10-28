import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from '../utils/email';
import { BRAND } from '../config/brand';
import config from '../config';

export interface DigestSections {
  nearbyAlumni: boolean; // "new alumni this week" in v1 (shared, not per-user geo)
  jobs: boolean;
  events: boolean;
  videos: boolean;
  requirements: boolean;
}

const DEFAULT_SECTIONS: DigestSections = { nearbyAlumni: true, jobs: true, events: true, videos: true, requirements: true };
const SINCE = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const SEND_BATCH = 200;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export class DigestService {
  async getSettings() {
    const row = await prisma.digestSettings.findUnique({ where: { id: 'default' } });
    return {
      id: 'default',
      enabled: row?.enabled ?? false,
      dayOfWeek: row?.dayOfWeek ?? 1,
      hour: row?.hour ?? 9,
      sections: { ...DEFAULT_SECTIONS, ...((row?.sections as Partial<DigestSections>) ?? {}) },
      lastRunAt: row?.lastRunAt ?? null,
    };
  }

  async updateSettings(data: { enabled?: boolean; dayOfWeek?: number; hour?: number; sections?: Partial<DigestSections> }) {
    const current = await this.getSettings();
    const enabled = typeof data.enabled === 'boolean' ? data.enabled : current.enabled;
    const dayOfWeek = Number.isInteger(data.dayOfWeek) ? Math.min(6, Math.max(0, data.dayOfWeek as number)) : current.dayOfWeek;
    const hour = Number.isInteger(data.hour) ? Math.min(23, Math.max(0, data.hour as number)) : current.hour;
    const sections = { ...current.sections, ...(data.sections ?? {}) };

    const saved = await prisma.digestSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', enabled, dayOfWeek, hour, sections: sections as object },
      update: { enabled, dayOfWeek, hour, sections: sections as object },
    });
    return { ...saved, sections };
  }

  /** Build the shared weekly digest body. Returns null when every enabled section is empty. */
  async buildDigest(sections: DigestSections): Promise<{ subject: string; html: string; text: string } | null> {
    const since = SINCE();
    const [jobs, events, videos, requirements, newMembers] = await Promise.all([
      sections.jobs
        ? prisma.jobOpportunity.findMany({ where: { status: 'PUBLISHED', createdAt: { gte: since } }, orderBy: [{ isOfficial: 'desc' }, { createdAt: 'desc' }], take: 5, select: { id: true, title: true, company: true } })
        : [],
      sections.events
        ? prisma.event.findMany({ where: { status: 'PUBLISHED', isPublic: true, startDate: { gte: new Date() } }, orderBy: { startDate: 'asc' }, take: 3, select: { id: true, title: true, startDate: true } })
        : [],
      sections.videos
        ? prisma.collegeVideo.findMany({ where: { status: 'APPROVED', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true } })
        : [],
      sections.requirements
        ? prisma.collegeRequirement.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true } })
        : [],
      sections.nearbyAlumni
        ? prisma.user.count({ where: { isActive: true, isVerified: true, createdAt: { gte: since } } })
        : 0,
    ]);

    const base = config.frontendUrl?.replace(/\/$/, '') || '';
    const blocks: string[] = [];
    const textBlocks: string[] = [];

    if (sections.nearbyAlumni && newMembers > 0) {
      blocks.push(`<p style="margin:0 0 16px"><strong>${newMembers}</strong> new alumni joined this week. <a href="${base}/directory">Say hello →</a></p>`);
      textBlocks.push(`${newMembers} new alumni joined this week: ${base}/directory`);
    }
    const list = (title: string, items: string[]) => {
      blocks.push(`<h3 style="margin:20px 0 8px;color:${'#0B2A5B'}">${title}</h3><ul style="margin:0;padding-left:18px">${items.join('')}</ul>`);
    };
    if (jobs.length) {
      list('New jobs', jobs.map((j) => `<li><a href="${base}/jobs/${j.id}">${esc(j.title)}</a> — ${esc(j.company)}</li>`));
      textBlocks.push('New jobs:\n' + jobs.map((j) => `- ${j.title} — ${j.company} (${base}/jobs/${j.id})`).join('\n'));
    }
    if (events.length) {
      list('Upcoming events', events.map((e) => `<li><a href="${base}/events/${e.id}">${esc(e.title)}</a> — ${new Date(e.startDate).toLocaleDateString()}</li>`));
      textBlocks.push('Upcoming events:\n' + events.map((e) => `- ${e.title} — ${new Date(e.startDate).toLocaleDateString()}`).join('\n'));
    }
    if (videos.length) {
      list('New videos', videos.map((v) => `<li><a href="${base}/videos">${esc(v.title)}</a></li>`));
      textBlocks.push('New videos:\n' + videos.map((v) => `- ${v.title}`).join('\n'));
    }
    if (requirements.length) {
      list('The college needs help with', requirements.map((r) => `<li><a href="${base}/requirements">${esc(r.title)}</a></li>`));
      textBlocks.push('The college needs help with:\n' + requirements.map((r) => `- ${r.title}`).join('\n'));
    }

    if (blocks.length === 0) return null;

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1A2230">
        <h2 style="color:#0B2A5B;margin:0 0 4px">${BRAND.appName}</h2>
        <p style="margin:0 0 16px;color:#64748b">Your weekly round-up from the ${esc(BRAND.orgName)}.</p>
        ${blocks.join('')}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="font-size:12px;color:#94a3b8">
          You're receiving this because you're a member of ${BRAND.appName}.
          <a href="${base}/settings">Manage email preferences</a>.
        </p>
      </div>`;
    const text = `${BRAND.appName} — your weekly round-up\n\n${textBlocks.join('\n\n')}\n\nManage preferences: ${base}/settings`;
    return { subject: `${BRAND.appName}: your weekly round-up`, html, text };
  }

  /** Send the digest. With `testUserId`, sends only to that member. Returns the count sent. */
  async sendDigest(opts: { testUserId?: string } = {}): Promise<number> {
    const settings = await this.getSettings();
    const digest = await this.buildDigest(settings.sections);
    if (!digest) return 0;

    if (opts.testUserId) {
      const user = await prisma.user.findUnique({ where: { id: opts.testUserId }, select: { email: true } });
      if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
      await sendEmail({ to: user.email, subject: `[Test] ${digest.subject}`, html: digest.html, text: digest.text });
      return 1;
    }

    let cursor: string | undefined;
    let sent = 0;
    for (;;) {
      const users = await prisma.user.findMany({
        where: { isActive: true, isVerified: true, digestOptOut: false },
        select: { id: true, email: true },
        orderBy: { id: 'asc' },
        take: SEND_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) break;
      for (const u of users) {
        try {
          await sendEmail({ to: u.email, subject: digest.subject, html: digest.html, text: digest.text });
          sent++;
        } catch (err) {
          console.error('Digest send failed for', u.id, (err as Error).message);
        }
      }
      if (users.length < SEND_BATCH) break;
      cursor = users[users.length - 1].id;
    }
    return sent;
  }

  /** Called on a schedule (hourly). Sends once per week when the configured day/hour matches. */
  async runIfDue(now: Date = new Date()): Promise<{ ran: boolean; sent?: number }> {
    const s = await this.getSettings();
    if (!s.enabled) return { ran: false };
    if (now.getDay() !== s.dayOfWeek || now.getHours() !== s.hour) return { ran: false };
    // Dedupe: don't re-send within 6 days of the last run.
    if (s.lastRunAt && now.getTime() - new Date(s.lastRunAt).getTime() < 6 * 24 * 60 * 60 * 1000) return { ran: false };

    await prisma.digestSettings.update({ where: { id: 'default' }, data: { lastRunAt: now } });
    const sent = await this.sendDigest();
    return { ran: true, sent };
  }
}

export const digestService = new DigestService();
