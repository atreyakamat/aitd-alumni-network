'use client';

import * as React from 'react';
import { Sparkles, X } from 'lucide-react';
import { userApi } from '@/lib/api';
import { addSkill, SKILL_NAME_MAX, SKILLS_MAX, type ProfileSkill } from '@/lib/profile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SaveButton, useSectionSave, type SectionProps } from './shared';

const namesOf = (skills: ProfileSkill[] | undefined) =>
  (skills ?? []).map((entry) => entry?.skill?.name).filter((name): name is string => Boolean(name));

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((name, i) => name === b[i]);

export function SkillsSection({ skills: initialSkills, onSaved }: SectionProps & { skills?: ProfileSkill[] }) {
  const [saved, setSaved] = React.useState<string[]>(() => namesOf(initialSkills));
  const [skills, setSkills] = React.useState<string[]>(saved);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const { saving, run } = useSectionSave(onSaved);

  const add = () => {
    const next = addSkill(skills, draft);
    setError(next.error ?? null);
    if (!next.error) {
      setSkills(next.skills);
      setDraft('');
    }
  };

  const remove = (name: string) => {
    setSkills((prev) => prev.filter((skill) => skill !== name));
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && skills.length) {
      remove(skills[skills.length - 1]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await run(() => userApi.updateSkills(skills), {
      success: 'Skills saved',
      failure: 'Could not save skills',
    });
    if (outcome.ok) {
      const returned = (outcome.result as { data?: { data?: ProfileSkill[] } } | undefined)?.data?.data;
      const stored = Array.isArray(returned) ? namesOf(returned) : skills;
      setSaved(stored);
      setSkills(stored);
    }
  };

  const dirty = !sameList(saved, skills);

  return (
    <Card id="skills">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          Skills
        </CardTitle>
        <CardDescription>
          Alumni can find you by skill in the directory. Up to {SKILLS_MAX} skills.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <ul className="flex flex-wrap gap-2" aria-label="Your skills">
            {skills.length === 0 && <li className="text-sm text-muted-foreground">No skills added yet.</li>}
            {skills.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1 rounded-full border bg-secondary px-3 py-1 text-sm"
              >
                {name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => remove(name)}
                  aria-label={`Remove ${name}`}
                  disabled={saving}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <Label htmlFor="skill-input">Add a skill</Label>
            <div className="flex gap-2">
              <Input
                id="skill-input"
                placeholder="e.g. Product management"
                value={draft}
                maxLength={SKILL_NAME_MAX + 20}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                disabled={saving}
                aria-describedby={error ? 'skill-input-error' : 'skill-input-hint'}
              />
              <Button type="button" variant="outline" onClick={add} disabled={saving || !draft.trim()}>
                Add
              </Button>
            </div>
            <p id="skill-input-hint" className="text-xs text-muted-foreground">
              Press Enter to add. {skills.length}/{SKILLS_MAX} skills.
            </p>
            {error && (
              <p id="skill-input-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <SaveButton saving={saving} label="Save skills" disabled={!dirty} />
        </form>
      </CardContent>
    </Card>
  );
}
