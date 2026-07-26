import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "亲宝贝家庭云相册",
  description: "连接百度网盘，整理宝宝照片和视频时间线。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
