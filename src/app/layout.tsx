import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://resskim-io.github.io/my-blog";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Ress Blog",
    template: "%s | Ress Blog",
  },
  description: "Learning by doing, documenting the journey",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Ress Blog",
  },
  twitter: {
    card: "summary",
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

const themeScript = `
  (function() {
    var t = localStorage.getItem('theme');
    if (!t) t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
