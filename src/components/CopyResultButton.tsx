"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { copyText } from "@/utils/shareCard";

type Status = "idle" | "copied" | "failed";

export function CopyResultButton({ text }: { text: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    const ok = await copyText(text);
    setStatus(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 2000);
  };

  const label = status === "copied" ? "Copied!" : status === "failed" ? "Copy failed" : "Copy Result";

  return (
    <motion.button
      onClick={onCopy}
      whileTap={{ scale: 0.97 }}
      aria-live="polite"
      className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
        status === "copied"
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
          : status === "failed"
            ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
            : "border-zinc-700 text-zinc-200 hover:bg-zinc-900"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {status === "copied" ? "✓ " : ""}
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
