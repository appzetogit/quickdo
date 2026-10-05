import { useState, useEffect } from 'react';

/**
 * Hook to calculate the height of the admin header.
 * Used to add padding-top to admin page content on mobile (fixed header).
 */
const useAdminHeaderHeight = () => {
  const [headerHeight, setHeaderHeight] = useState(72); // default ~ single-vendor

  useEffect(() => {
    const calculateHeight = () => {
      const header = document.querySelector('header[class*="fixed"][class*="top-0"]');
      if (header) {
        setHeaderHeight(header.offsetHeight);
        return;
      }
      const fallbackHeader = document.querySelector('header.fixed');
      if (fallbackHeader) setHeaderHeight(fallbackHeader.offsetHeight);
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);

    const t1 = window.setTimeout(calculateHeight, 100);
    const t2 = window.setTimeout(calculateHeight, 500);

    const observer = new MutationObserver(calculateHeight);
    const header = document.querySelector('header[class*="fixed"][class*="top-0"]');
    if (header) {
      observer.observe(header, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true,
      });
    }

    return () => {
      window.removeEventListener('resize', calculateHeight);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      observer.disconnect();
    };
  }, []);

  return headerHeight;
};

export default useAdminHeaderHeight;



