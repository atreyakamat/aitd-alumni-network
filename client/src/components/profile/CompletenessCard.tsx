'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import { completenessHints, type EditableProfile } from '@/lib/profile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** Score comes from the server (/auth/me profileCompleteness); hints mirror its scoring fields. */
export function CompletenessCard({ score, profile }: { score: number; profile: Partial<EditableProfile> }) {
  const value = Math.max(0, Math.min(100, Math.round(score || 0)));
  const hints = completenessHints(profile);
  const missing = hints.filter((hint) => !hint.done);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Profile completeness</CardTitle>
        <CardDescription>
          {missing.length === 0 ? 'Your profile is complete.' : 'Complete profiles show up higher in the directory.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold" data-testid="completeness-score">
              {value}%
            </span>
          </div>
          <Progress
            value={value}
            className="h-2"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
          />
        </div>
        <ul className="space-y-2 text-sm" aria-label="Profile checklist">
          {hints.map((hint) => (
            <li
              key={hint.id}
              data-done={hint.done}
              className={cn('flex items-center gap-2', hint.done ? 'text-muted-foreground line-through' : '')}
            >
              {hint.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              <span className="flex-1">{hint.label}</span>
              {!hint.done && <span className="text-xs font-medium text-primary">+{hint.points}%</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
