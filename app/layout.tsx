import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "./globals.css";
import { GlobalThemeProvider } from "../components/GlobalThemeProvider";

export const metadata: Metadata = {
  title: "SevenMedia Studio — Local Media Tools",
  description: "Compress, convert, and edit video, images, and audio locally.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body><AntdRegistry><GlobalThemeProvider>{children}</GlobalThemeProvider></AntdRegistry></body></html>;
}
