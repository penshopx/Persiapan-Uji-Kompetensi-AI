export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true">
      <rect width="96" height="96" fill="#0a0e17" />
      <rect x="4" y="4" width="88" height="88" fill="none" stroke="#4da3ff" strokeWidth="4" />
      <path d="M20 70 48 22l28 48z" fill="none" stroke="#dbeafe" strokeWidth="6" />
      <path d="M34 70V54h28v16" fill="#4da3ff" />
      <rect x="42" y="40" width="12" height="8" fill="#dbeafe" />
    </svg>
  );
}
