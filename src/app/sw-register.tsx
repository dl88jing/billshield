"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline";

export default function SwRegister() {
  useEffect(() => { registerServiceWorker(); }, []);
  return null;
}
