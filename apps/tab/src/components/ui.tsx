import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { T } from "../theme.js";

/**
 * UI primitives — every interactive element goes through these (or the
 * matching CSS classes in styles.css) so hover, focus, and disabled states
 * are consistent everywhere.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid" | "success" | "ai" | "link";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
  dangerSolid: "btn btn-danger-solid",
  success: "btn btn-success",
  ai: "btn btn-ai",
  link: "btn-link",
};

export function Button({
  variant = "primary",
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "lg" }) {
  const sizeClass = size === "sm" ? " btn-sm" : size === "lg" ? " btn-lg" : "";
  return <button type="button" className={`${VARIANT_CLASS[variant]}${variant === "link" ? "" : sizeClass}${className ? ` ${className}` : ""}`} {...props} />;
}

export function Card({
  title,
  right,
  children,
  className,
  style,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`} style={style}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          {title && (
            <h2 style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, color: T.ink, textTransform: "uppercase" }}>
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ textAlign: "center", padding: "34px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {icon && <div style={{ fontSize: 26, opacity: 0.65 }}>{icon}</div>}
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: T.inkMuted, maxWidth: 420, lineHeight: 1.5 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/** Breadcrumb row used at the top of every workspace page. */
export function Crumbs({ trail }: { trail: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {trail.map((c, i) => (
        <span key={`${c.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: T.inkMuted, fontSize: 11 }}>/</span>}
          {c.onClick ? (
            <button type="button" className="crumb" onClick={c.onClick}>
              {c.label}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: T.ink, fontWeight: 600 }}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
