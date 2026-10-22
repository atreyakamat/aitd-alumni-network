'use client';

import * as React from 'react';
import { ImageIcon, Loader2, Upload } from 'lucide-react';
import { userApi } from '@/lib/api';
import { PHOTO_ACCEPT, validatePhotoFile, type EditableProfile } from '@/lib/profile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getInitials } from '@/lib/utils';
import { useSectionSave, type SectionProps } from './shared';

type PhotoKind = 'profile' | 'cover';

const createPreview = (file: File): string | null =>
  typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;

const revokePreview = (url: string | null) => {
  if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

function PhotoPicker({
  kind,
  currentUrl,
  fullName,
  onSaved,
}: {
  kind: PhotoKind;
  currentUrl?: string | null;
  fullName: string;
} & SectionProps) {
  const inputId = `${kind}-photo-input`;
  const label = kind === 'profile' ? 'Profile photo' : 'Cover photo';
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { saving, run } = useSectionSave(onSaved);

  React.useEffect(() => () => revokePreview(preview), [preview]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const problem = validatePhotoFile(selected);
    if (problem) {
      setError(problem);
      reset();
      return;
    }
    setError(null);
    setFile(selected);
    setPreview(createPreview(selected));
  };

  const handleUpload = async () => {
    if (!file) return;
    const outcome = await run(
      () => (kind === 'profile' ? userApi.uploadProfilePhoto(file) : userApi.uploadCoverPhoto(file)),
      { success: `${label} updated`, failure: `Could not upload ${label.toLowerCase()}` }
    );
    if (outcome.ok) reset();
  };

  const shown = preview || currentUrl || undefined;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{label}</p>
      {kind === 'profile' ? (
        <Avatar className="h-24 w-24 border">
          <AvatarImage src={shown} alt={file ? 'New profile photo preview' : 'Current profile photo'} />
          <AvatarFallback className="text-2xl">{getInitials(fullName || '?')}</AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-28 w-full overflow-hidden rounded-md border bg-gradient-to-r from-primary to-primary/60">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob previews cannot go through next/image
            <img src={shown} alt={file ? 'New cover photo preview' : 'Current cover photo'} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-primary-foreground/80">
              <ImageIcon className="h-8 w-8" aria-hidden />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          onChange={handleChange}
          disabled={saving}
          aria-describedby={`${inputId}-hint`}
        />
        <Button type="button" variant="outline" size="sm" asChild disabled={saving}>
          <label htmlFor={inputId} className="cursor-pointer">
            <Upload className="h-4 w-4 mr-2" aria-hidden />
            Choose {label.toLowerCase()}
          </label>
        </Button>
        {file && (
          <>
            <Button type="button" size="sm" onClick={handleUpload} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
              {saving ? 'Uploading...' : `Upload ${label.toLowerCase()}`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          </>
        )}
      </div>
      <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
        JPG, PNG or GIF, up to 5 MB.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function PhotosSection({ profile, onSaved }: SectionProps & { profile: EditableProfile }) {
  return (
    <Card id="photos">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" aria-hidden />
          Photos
        </CardTitle>
        <CardDescription>A clear profile photo helps classmates recognise you.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <PhotoPicker kind="profile" currentUrl={profile.profilePhotoUrl} fullName={profile.fullName} onSaved={onSaved} />
        <PhotoPicker kind="cover" currentUrl={profile.coverPhotoUrl} fullName={profile.fullName} onSaved={onSaved} />
      </CardContent>
    </Card>
  );
}
