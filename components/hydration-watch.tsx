"use client";

import { useEffect } from "react";

/** Marks the document once React controls the page; the server-rendered `.js-stalled` notice keys off it. */
export function HydrationWatch() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
