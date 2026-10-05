import React, { forwardRef } from 'react';

/**
 * Centralized Logo Component
 * Usage: <Logo className="h-8 w-auto" />
 * Supports ref for animations
 */
const Logo = forwardRef(({ className = "h-14 sm:h-20 w-auto", ...props }, ref) => {
  return (
    <img
      ref={ref}
      src="/truliq-logo.png"
      alt="Truliq - Trusted Home Services"
      className={`${className} object-contain transition-transform duration-300`}
      {...props}
    />
  );
});

Logo.displayName = 'Logo';

export default Logo;

