'use client';

import * as React from 'react';
import { AlertCircle, Bell, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  getApiErrorMessage,
  notificationApi,
  type NotificationCategory,
  type NotificationPreference,
} from '@/lib/api';

type Channel = 'inApp' | 'email';

const CATEGORY_TEXT: Record<NotificationCategory, { label: string; hint: string }> = {
  CONNECTIONS: { label: 'Connections and followers', hint: 'Connection requests, accepted requests and new followers' },
  MESSAGES: { label: 'Messages', hint: 'New messages and message requests' },
  POSTS_AND_COMMENTS: { label: 'Posts and comments', hint: 'Likes, reactions, comments, replies, reposts and mentions' },
  EVENTS: { label: 'Events', hint: 'Activity on events you organise' },
  JOBS_AND_MENTORSHIP: { label: 'Jobs and mentorship', hint: 'Job matches and mentorship requests and sessions' },
  ANNOUNCEMENTS: { label: 'College announcements', hint: 'News from the college, and the weekly digest e-mail' },
};

const CHANNEL_TEXT: Record<Channel, string> = { inApp: 'In-app', email: 'E-mail' };

export function NotificationSettingsCard() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<NotificationPreference[] | null>(null);
  const [alwaysOn, setAlwaysOn] = React.useState<string[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<Set<string>>(new Set());
  const [status, setStatus] = React.useState('');

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const res = await notificationApi.getPreferences();
      setRows(res.data.data.preferences);
      setAlwaysOn(res.data.data.alwaysOn ?? []);
    } catch {
      setLoadError('Could not load your notification settings.');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (category: NotificationCategory, channel: Channel, value: boolean) => {
    const key = `${category}:${channel}`;
    const before = rows;
    // Shown at once, put back if the server refuses
    setRows((current) => current?.map((row) => (row.category === category ? { ...row, [channel]: value } : row)) ?? current);
    setSaving((current) => new Set(current).add(key));
    setStatus('');
    try {
      const res = await notificationApi.updatePreferences([{ category, [channel]: value }]);
      setRows(res.data.data.preferences);
      setStatus(`${CATEGORY_TEXT[category].label}, ${CHANNEL_TEXT[channel]}: ${value ? 'on' : 'off'}. Saved.`);
    } catch (err) {
      setRows(before);
      toast({
        title: 'Could not save that setting',
        description: getApiErrorMessage(err, 'Please try again in a moment.'),
        variant: 'destructive',
      });
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Notifications
        </CardTitle>
        <CardDescription>
          Choose what you hear about, in the app (the bell) and by e-mail. Everything is on until you switch it off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : rows === null ? (
          <div aria-busy="true" aria-label="Loading notification settings" className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <fieldset>
            <legend className="sr-only">Notification settings</legend>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Category
                  </th>
                  <th scope="col" className="py-2 px-3 font-medium text-center">
                    {CHANNEL_TEXT.inApp}
                  </th>
                  <th scope="col" className="py-2 pl-3 font-medium text-center">
                    {CHANNEL_TEXT.email}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const text = CATEGORY_TEXT[row.category];
                  if (!text) return null;
                  return (
                    <tr key={row.category} className="border-t">
                      <th scope="row" className="py-3 pr-4 text-left font-normal">
                        <span className="font-medium">{text.label}</span>
                        <span className="block text-xs text-muted-foreground">{text.hint}</span>
                      </th>
                      {(['inApp', 'email'] as const).map((channel) => (
                        <td key={channel} className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            aria-label={`${text.label}: ${CHANNEL_TEXT[channel]}`}
                            checked={row[channel]}
                            disabled={saving.has(`${row.category}:${channel}`)}
                            onChange={(e) => void toggle(row.category, channel, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {alwaysOn.includes('ACCOUNT_AND_SECURITY') && (
                  <tr className="border-t bg-muted/40">
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      <span className="font-medium flex items-center gap-1">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Account, security and payments
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Approval of your registration, password and sign-in security, membership and payment receipts, and
                        administrator work items. These are always sent and cannot be switched off.
                      </span>
                    </th>
                    {(['inApp', 'email'] as const).map((channel) => (
                      <td key={channel} className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={`Account, security and payments: ${CHANNEL_TEXT[channel]} (always on)`}
                          checked
                          disabled
                          readOnly
                        />
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              Today the college sends e-mail for announcements (the weekly digest). Your e-mail choices for the other
              categories are saved and apply as those e-mails are introduced.
            </p>
          </fieldset>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
      </CardContent>
    </Card>
  );
}
