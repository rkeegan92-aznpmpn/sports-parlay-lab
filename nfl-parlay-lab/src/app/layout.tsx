import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = {
  title: 'NFL Parlay Lab',
  description: 'NFL player-prop research tool. Not betting advice.',
  applicationName: 'NFL Parlay Lab',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'Parlay Lab', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b1220',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
