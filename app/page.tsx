import type { Metadata } from "next";
import { AuthGate } from "./AuthGate";

export const metadata: Metadata = {
  title: "亲宝贝家庭云相册",
  description: "上传照片和视频，按时间线整理宝宝成长记录。",
};

export default function Home() {
  return <AuthGate />;
}
