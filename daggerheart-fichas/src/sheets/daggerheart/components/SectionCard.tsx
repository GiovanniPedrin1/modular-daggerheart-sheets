import type { ReactNode } from "react";

type SectionCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
};

export function SectionCard({
  title,
  subtitle,
  children,
  className = "",
  innerClassName = "",
}: SectionCardProps) {
  return (
    <section className={`dh-card ${className}`}>
      <div className="dh-section-title">
        {title}
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      <div className={`dh-inner ${innerClassName}`}>{children}</div>
    </section>
  );
}
