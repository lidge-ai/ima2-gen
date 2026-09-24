import "../styles/brand-mark.css";

/** The ima2 "2" mark, tinted by the surrounding text colour. Decorative only. */
export function BrandMark({ className }: { className?: string }) {
  return <span className={className ? `brand-mark ${className}` : "brand-mark"} aria-hidden="true" />;
}
