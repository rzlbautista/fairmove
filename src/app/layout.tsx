import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairMove — Mission Control",
  description:
    "Voice agents that call, compare and negotiate moving quotes — with itemised fees, red flags and transcript evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
