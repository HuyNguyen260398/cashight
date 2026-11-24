'use client';

import { useEffect, useState } from 'react';
import Button from '@cloudscape-design/components/button';

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1001 }}>
      <Button
        variant="primary"
        iconName="arrow-up"
        ariaLabel="Scroll to top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </div>
  );
}
