import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Padel Poll",
  description: "Available 8pm padel slots at Project Padel for the next 21 days",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
