
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REALTY AI STUDIO",
  description: "Инструменты для обработки фотографий недвижимости и создания планировок.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
