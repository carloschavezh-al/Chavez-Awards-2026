import { useState } from 'react';

interface NomineeAvatarProps {
  name: string;
  photoUrl?: string;
  accentColor?: string;
  fallbackLabel?: string;
  className?: string;
  textClassName?: string;
}

export default function NomineeAvatar({
  name,
  photoUrl,
  accentColor = '#D97706',
  fallbackLabel,
  className = 'w-12 h-12 rounded-xl',
  textClassName = 'text-base font-semibold',
}: NomineeAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const cleanUrl = photoUrl?.trim() || '';
  const showImage = Boolean(cleanUrl) && failedSrc !== cleanUrl;

  if (showImage) {
    return (
      <div className={`overflow-hidden shrink-0 bg-slate-900/10 ${className}`}>
        <img
          src={cleanUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(cleanUrl)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const initial = (fallbackLabel ?? (name.trim().charAt(0) || '?')).toUpperCase();

  return (
    <div
      className={`shrink-0 flex items-center justify-center text-white font-display select-none ${className} ${textClassName}`}
      style={{ backgroundColor: accentColor }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
