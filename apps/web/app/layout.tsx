import './globals.css';
import React from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { AuthProvider } from '../lib/auth-context';
import { Shell } from '../components/shell';
import { ThemeProvider } from '../components/ui/theme-provider';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Floz — Work Management OS',
  description: 'Simple Business Operating System / Work Management Platform',
  icons: {
    icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }, { url: '/brand/favicon.ico' }],
  },
};

const themeBootstrap = `(() => { const stored = localStorage.getItem('floz-theme'); const theme = stored === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; })()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body className={plusJakartaSans.variable}>
        <ThemeProvider>
          <AuthProvider>
            <Shell>{children}</Shell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
