import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist', subsets: ['latin', 'cyrillic'] });
const geistMono = Geist_Mono({ variable: '--font-mono', subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Fruit Rush — Motion Arcade',
  description: 'Аркадная браузерная игра с управлением движением рук, мышью или касанием.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
