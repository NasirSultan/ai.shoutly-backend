import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Finder",
  description: "Find people on Reddit and Facebook who are looking to hire.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
