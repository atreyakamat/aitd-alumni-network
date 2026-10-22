'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { findMentionQuery, insertMention, mediaSrc, socialApi, type AuthorLite, type MentionRef } from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

export interface MentionTextareaHandle {
  focus: () => void;
}

/**
 * Textarea with @mention autocomplete. Typing "@as" searches members; ↑/↓ + Enter (or a click)
 * inserts "@Full Name ". The chosen people are reported through `onMentionsChange`.
 */
export const MentionTextarea = forwardRef<MentionTextareaHandle, {
  value: string;
  onChange: (value: string) => void;
  mentions: MentionRef[];
  onMentionsChange: (mentions: MentionRef[]) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  ariaLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmitShortcut?: () => void;
  searchMentions?: (q: string, signal: AbortSignal) => Promise<AuthorLite[]>;
}>(function MentionTextarea(
  { value, onChange, mentions, onMentionsChange, placeholder, maxLength, className, ariaLabel, disabled, autoFocus, onSubmitShortcut, searchMentions },
  ref
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [results, setResults] = useState<AuthorLite[]>([]);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query?.query ?? null, 200);
  const listId = useRef(`mention-list-${Math.random().toString(36).slice(2)}`).current;

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  useEffect(() => {
    if (debounced === null || debounced.length < 1) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const search = searchMentions ?? ((q: string, signal: AbortSignal) => socialApi.mentionSearch(q, { signal }));
    search(debounced, controller.signal)
      .then((people) => {
        setResults(people.slice(0, 8));
        setActive(0);
      })
      .catch(() => setResults([]));
    return () => controller.abort();
  }, [debounced, searchMentions]);

  const updateQuery = (text: string, caret: number) => setQuery(findMentionQuery(text, caret));

  const choose = (person: AuthorLite) => {
    const el = textareaRef.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const next = insertMention(value, query.start, caret, person.fullName);
    onChange(next.text);
    if (!mentions.some((m) => m.id === person.id)) onMentionsChange([...mentions, { id: person.id, fullName: person.fullName }]);
    setQuery(null);
    setResults([]);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const open = query !== null && results.length > 0;

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={cn('resize-none', className)}
        onChange={(e) => {
          onChange(e.target.value);
          updateQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => updateQuery(value, e.currentTarget.selectionStart ?? value.length)}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const person = results.at(active);
              if (person) choose(person);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
            e.preventDefault();
            onSubmitShortcut();
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Mention someone" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
          {results.map((person, i) => (
            <li
              key={person.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(person);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm', i === active && 'bg-muted')}
            >
              <Avatar className="h-7 w-7">
                <AvatarImage src={mediaSrc(person.profilePhotoUrl) || undefined} alt="" />
                <AvatarFallback className="text-[10px]">{getInitials(person.fullName)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate font-medium">{person.fullName}</span>
                {person.currentDesignation && <span className="block truncate text-xs text-muted-foreground">{person.currentDesignation}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
