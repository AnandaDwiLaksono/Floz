import React from 'react';
import Image from 'next/image';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      src={compact ? '/brand/floz-mark.svg' : '/brand/floz-logo.svg'}
      alt="Floz"
      width={compact ? 40 : 144}
      height={compact ? 40 : 48}
      priority
    />
  );
}
