import './globals.css';
import React from 'react';
import { AuthProvider } from '../lib/auth-context';
import { Shell } from '../components/shell';

export const metadata = {
  title: 'Floz — Work Management OS',
  description: 'Simple Business Operating System / Work Management Platform',
  icons: {
    icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }, { url: '/brand/favicon.ico' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
