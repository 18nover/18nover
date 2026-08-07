import type { Metadata } from "next";
import LockardDashboard from "./lockard-dashboard";

export const metadata: Metadata = {
  title: "Lockard Live — Private RTSP streaming",
  description: "A private, one-to-many operations dashboard for live RTSP cameras.",
};

export default function Home() {
  return <LockardDashboard />;
}
