import { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="ahd-card">
      {title && <h3 className="ahd-card-title">{title}</h3>}
      <div className="ahd-card-body">{children}</div>
    </div>
  );
}
