'use client';

import { CheckCircle2, ExternalLink, MailWarning, UserCheck, UserX, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { safeHref } from '@/lib/safe-url';
import type { RegistrationApplication } from '@/lib/api';

const ROLE_TYPE_LABELS: Record<string, string> = { ALUMNI: 'Alumni', STUDENT: 'Student' };

const roleTypeLabel = (value?: string | null) => (value ? ROLE_TYPE_LABELS[value] ?? value : null);

/** Only a plain http(s) address becomes a link: the applicant typed it, so it is never trusted. */
const profileHref = (value: string | null): string | undefined => {
  const href = safeHref(value);
  return href && /^https?:\/\//i.test(href) ? href : undefined;
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? <span className="text-muted-foreground">Not given</span>}</dd>
    </div>
  );
}

interface RegistrationCardProps {
  application: RegistrationApplication;
  /** True while a decision on ANY registration is being sent: nothing else may be clicked meanwhile. */
  busy: boolean;
  onApprove: (application: RegistrationApplication) => void;
  onReject: (application: RegistrationApplication) => void;
}

/**
 * One registration, with everything the reviewer needs to decide whether this person is an alumnus of the college.
 * Everything the applicant typed (name, enrolment number, note) is rendered as TEXT, never as HTML.
 */
export function RegistrationCard({ application: a, busy, onApprove, onReject }: RegistrationCardProps) {
  const link = profileHref(a.linkedinUrl);
  const verified = !!a.emailVerifiedAt;
  const reviewer = a.approvalReviewedBy?.fullName ?? 'an administrator';

  return (
    <Card>
      <article aria-label={`Registration of ${a.fullName}`}>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">{a.fullName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="break-all">{a.email}</span>
                {verified ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> E-mail verified
                  </Badge>
                ) : (
                  <Badge variant="warning" className="gap-1">
                    <MailWarning className="h-3 w-3" aria-hidden /> E-mail not verified
                  </Badge>
                )}
                {!a.isActive && <Badge variant="destructive">Deactivated</Badge>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Applied {formatDate(a.createdAt)}</p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Detail label="Batch">{a.batchYear ?? null}</Detail>
            <Detail label="Department">{a.department || null}</Detail>
            <Detail label="Degree">{a.degree || null}</Detail>
            <Detail label="Role">{roleTypeLabel(a.roleType)}</Detail>
            <Detail label="Enrolment number">{a.enrollmentNumber || null}</Detail>
          </dl>

          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Note from the applicant</h3>
            {a.verificationNote ? (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{a.verificationNote}</p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">None</p>
            )}
          </div>

          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              LinkedIn profile <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}

          {a.approvalStatus !== 'PENDING' && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <p className="flex flex-wrap items-center gap-1 font-medium">
                {a.approvalStatus === 'APPROVED' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                )}
                <span>
                  {a.approvalStatus === 'APPROVED' ? 'Approved' : 'Rejected'} by {reviewer}
                  {a.approvalReviewedAt ? ` on ${formatDate(a.approvalReviewedAt)}` : ''}
                </span>
              </p>
              {a.approvalNote && (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {a.approvalStatus === 'APPROVED' ? 'Note: ' : 'Reason: '}
                  <span className="text-foreground">{a.approvalNote}</span>
                </p>
              )}
            </div>
          )}

          {a.approvalStatus !== 'APPROVED' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onApprove(a)} disabled={busy}>
                <UserCheck className="mr-1 h-4 w-4" /> Approve
              </Button>
              {/* A rejection is final for the person, but not for the reviewer: the server still lets an administrator approve it later */}
              {a.approvalStatus === 'PENDING' && (
                <Button size="sm" variant="outline" onClick={() => onReject(a)} disabled={busy}>
                  <UserX className="mr-1 h-4 w-4" /> Reject
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </article>
    </Card>
  );
}
