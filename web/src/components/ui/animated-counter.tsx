"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rolling number, reproducing the reference's counter: each digit sits in an
 * overflow-hidden cell with a transparent placeholder holding the width, and the visible
 * row slides in from the bottom when the value grows or from the top when it shrinks.
 */
export function AnimatedCounter({ value, className = "" }: { value: number; className?: string }) {
  const text = String(value);
  const previous = useRef(text);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (previous.current === text) return;
    setDirection(Number(text) >= Number(previous.current) ? "up" : "down");
    previous.current = text;
    const timer = window.setTimeout(() => setDirection(null), 220);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <span className={`animated-counter ${className}`} aria-hidden>
      {text.split("").map((digit, index) => (
        <span className="animated-counter-digit" key={`${index}-${digit}`}>
          <span className="animated-counter-placeholder" aria-hidden>
            {digit}
          </span>
          <span
            className={`animated-counter-row${direction === "up" ? " enter-from-bottom" : direction === "down" ? " enter-from-top" : ""}`}
          >
            {digit}
          </span>
        </span>
      ))}
    </span>
  );
}
