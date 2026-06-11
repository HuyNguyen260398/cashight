'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getRevealDelayStyle } from '@/lib/reveal';
import { cn } from '@/lib/utils';

export function RevealPanel({
  children,
  className,
  delayIndex = 0,
}: {
  children: ReactNode;
  className?: string;
  delayIndex?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRevealed(true);
        observer.unobserve(entry.target);
      },
      {
        root: null,
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.12,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={getRevealDelayStyle(delayIndex)}
      className={cn(
        'motion-safe:transition-[opacity,transform] motion-safe:duration-500 motion-safe:ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100',
        revealed ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
