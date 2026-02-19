import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ress Blog",
  description: "Learning by doing, documenting the journey",
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
