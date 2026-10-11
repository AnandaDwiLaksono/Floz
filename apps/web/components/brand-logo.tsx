import React from 'react';
import Image from 'next/image';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Image
        src="/brand/floz-mark.svg"
        alt="Floz"
        width={40}
        height={40}
        priority
      />
    );
  }

  return (
    <>
      <Image
        src="/brand/floz-logo.svg"
        alt="Floz"
        width={144}
        height={48}
        priority
        className="dark:hidden"
      />
      <Image
        src="/brand/floz-logo-dark.svg"
        alt="Floz"
        width={144}
        height={48}
        priority
        className="hidden dark:block"
      />
    </>
  );
}
