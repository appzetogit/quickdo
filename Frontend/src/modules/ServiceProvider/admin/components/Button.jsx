import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { FiLoader } from 'react-icons/fi';

// Copied structure from single-vendor admin Button (kept lightweight).
const Button = forwardRef(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      icon: Icon,
      iconPosition = 'left',
      isLoading = false,
      disabled = false,
      className = '',
      onClick,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-semibold transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-xs gap-1.5',
      md: 'px-5 py-3 text-sm gap-2',
      lg: 'px-6 py-3.5 text-base gap-2.5',
    };

    const variantStyles = {
      primary: {
        base: 'bg-gradient-to-r from-[#2874F0] to-[#4787F7] text-white shadow-[0_2px_8px_rgba(40,116,240,0.15)]',
        hover: 'hover:shadow-[0_4px_12px_rgba(40,116,240,0.25)] hover:scale-[1.02]',
        focus: 'focus:ring-[#2874F0]',
        active: 'active:scale-[0.98]',
      },
      ghost: {
        base: 'bg-transparent text-gray-700',
        hover: 'hover:bg-gray-100',
        focus: 'focus:ring-gray-400',
        active: 'active:scale-[0.98]',
      },
      icon: {
        base: 'p-2 text-gray-600 bg-transparent',
        hover: 'hover:bg-gray-100',
        focus: 'focus:ring-gray-400',
        active: 'active:scale-[0.95]',
      },
    };

    const styles = variantStyles[variant] || variantStyles.primary;
    const sizeStyle = sizeStyles[size] || sizeStyles.md;
    const isIconOnly = variant.startsWith('icon') || (Icon && !children);
    const buttonClasses = `
      ${baseStyles}
      ${styles.base}
      ${!disabled && !isLoading ? styles.hover : ''}
      ${styles.focus}
      ${styles.active}
      ${isIconOnly ? 'p-2' : sizeStyle}
      rounded-lg
      ${className}
    `
      .replace(/\s+/g, ' ')
      .trim();

    return (
      <motion.button
        ref={ref}
        type={type}
        onClick={onClick}
        disabled={disabled || isLoading}
        className={buttonClasses}
        whileHover={!disabled && !isLoading ? { scale: 1.02 } : {}}
        whileTap={!disabled && !isLoading ? { scale: 0.98 } : {}}
        transition={{ duration: 0.2 }}
        {...props}
      >
        {isLoading && <FiLoader className="animate-spin" />}
        {!isLoading && Icon && iconPosition === 'left' && <Icon className="flex-shrink-0" />}
        {children && <span>{children}</span>}
        {!isLoading && Icon && iconPosition === 'right' && <Icon className="flex-shrink-0" />}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

export default Button;



