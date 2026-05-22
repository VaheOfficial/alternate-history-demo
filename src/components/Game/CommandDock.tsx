import { type ReactNode } from "react";
import {
  ScrollIcon,
  FactoryIcon,
  DiskIcon,
  BookIcon,
  ChevronDownIcon,
} from "../ui/Icon";

export type DockTab = "orders" | "production" | "saves" | "history";

export function CommandDock({
  active,
  onActiveChange,
  collapsed,
  onCollapsedChange,
  panels,
  rightInset,
}: {
  active: DockTab;
  onActiveChange: (tab: DockTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  panels: Record<DockTab, ReactNode>;
  /** Right-edge offset in pixels (used when a side drawer is open). */
  rightInset?: number;
}) {
  const tabs: Array<{ key: DockTab; label: string; icon: ReactNode }> = [
    { key: "orders", label: "Orders", icon: <ScrollIcon /> },
    { key: "production", label: "Production", icon: <FactoryIcon /> },
    { key: "saves", label: "Saves", icon: <DiskIcon /> },
    { key: "history", label: "History", icon: <BookIcon /> },
  ];

  return (
    <div
      style={{
        ...dockStyle,
        height: collapsed ? 48 : 340,
        right: 16 + (rightInset ?? 0),
      }}
      className="ahd-motion-slide-up"
    >
      <div style={tabRowStyle}>
        <div style={tabGroupStyle}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                onActiveChange(t.key);
                if (collapsed) onCollapsedChange(false);
              }}
              style={{
                ...tabStyle,
                ...(active === t.key && !collapsed ? tabActiveStyle : {}),
              }}
              className="ahd-press"
              aria-current={active === t.key && !collapsed}
            >
              <span style={iconWrapStyle}>{t.icon}</span>
              <span style={tabLabelStyle}>{t.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          style={collapseButtonStyle}
          className="ahd-press"
          aria-label={collapsed ? "Expand command dock" : "Collapse command dock"}
        >
          <span
            style={{
              display: "inline-flex",
              transition: "transform 200ms ease",
              transform: collapsed ? "rotate(180deg)" : "rotate(0)",
            }}
          >
            <ChevronDownIcon />
          </span>
        </button>
      </div>
      {!collapsed && (
        <div style={panelBodyStyle} className="ahd-motion-fade-in">
          {panels[active]}
        </div>
      )}
    </div>
  );
}

const dockStyle: React.CSSProperties = {
  position: "absolute",
  left: 16,
  right: 16,
  bottom: 16,
  background:
    "linear-gradient(180deg, rgba(20, 23, 30, 0.96), rgba(15, 17, 21, 0.96))",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow:
    "0 16px 40px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset",
  display: "flex",
  flexDirection: "column",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  overflow: "hidden",
  transition: "height 220ms cubic-bezier(0.16, 1, 0.3, 1)",
  zIndex: 11,
};

const tabRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 8px",
  borderBottom: "1px solid var(--border)",
  flex: "0 0 auto",
};

const tabGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
};

const tabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  color: "var(--fg-muted)",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  letterSpacing: "-0.005em",
};

const tabActiveStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  borderColor: "var(--border-strong)",
  color: "var(--fg)",
  boxShadow: "0 1px 0 rgba(255, 255, 255, 0.04) inset",
};

const tabLabelStyle: React.CSSProperties = {};

const iconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  fontSize: "1.05em",
  lineHeight: 0,
};

const collapseButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  color: "var(--fg-muted)",
  fontSize: "1em",
};

const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "14px 16px 16px",
};
