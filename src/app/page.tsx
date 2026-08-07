import type { Metadata } from "next";
import Dashboard from "./dashboard";

export const metadata: Metadata = {
  title: "18nover — Private RTSP streaming",
  description: "A private, one-to-many operations dashboard for live RTSP cameras.",
};

export default function Home() {
  return <Dashboard />;
}
