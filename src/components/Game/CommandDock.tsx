import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ScrollIcon,
  DiskIcon,
  BookIcon,
  GearIcon,
  HammerIcon,
  SendIcon,
  CloseIcon,
} from "../ui/Icon";

export type DockTab =
  | "orders"
  | "advisor"
  | "diplomacy"
  | "plans"
  | "saves"
  | "history";

const WIDTH_STORAGE_KEY = "ahd:command-dock-width";
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTH = 460;

/**
 * Left-docked command sidebar. A persistent vertical icon strip
 * (always visible, 52px wide) plus an expandable panel area to its
 * right. Clicking an icon when collapsed expands to that tab;
 * clicking the icon of the currently-active tab collapses again.
 *
 * The panel area is resizable via a drag handle on its right edge.
 * Width persists in localStorage between sessions.
 */
export function CommandDock({
  active,
  onActiveChange,
  collapsed,
  onCollapsedChange,
  panels,
}: {
  active: DockTab;
  onActiveChange: (tab: DockTab) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  panels: Record<DockTab, ReactNode>;
}) {
  const tabs: Array<{ key: DockTab; label: string; icon: ReactNode }> = [
    { key: "orders", label: "Orders", icon: <ScrollIcon /> },
    { key: "advisor", label: "Advisor", icon: <GearIcon /> },
    { key: "diplomacy", label: "Diplomacy", icon: <SendIcon /> },
    { key: "plans", label: "Plans", icon: <HammerIcon /> },
    { key: "saves", label: "Saves", icon: <DiskIcon /> },
    { key: "history", label: "History", icon: <BookIcon /> },
  ];

  // Restore width from localStorage (clamped). Width is the PANEL area only,
  // not including the icon strip.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
      if (!raw) return DEFAULT_PANEL_WIDTH;
      const n = Number(raw);
      if (!Number.isFinite(n)) return DEFAULT_PANEL_WIDTH;
      return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, n));
    } catch {
      return DEFAULT_PANEL_WIDTH;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(panelWidth));
    } catch {
      // localStorage unavailable — ignore.
    }
  }, [panelWidth]);

  // Drag-to-resize. Mouse-down on the handle starts a session; while the
  // session is live we attach window-level listeners so the cursor can leave
  // the handle without the drag breaking.
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const next = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, r.startWidth + dx),
      );
      setPanelWidth(next);
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleIconClick = useCallback(
    (key: DockTab) => {
      if (collapsed) {
        // Strip-mode click → expand to that tab.
        onActiveChange(key);
        onCollapsedChange(false);
        return;
      }
      if (key === active) {
        // Expanded mode, clicking active tab again → collapse.
        onCollapsedChange(true);
        return;
      }
      // Expanded mode, switching tabs.
      onActiveChange(key);
    },
    [active, collapsed, onActiveChange, onCollapsedChange],
  );

  const activeTab = tabs.find((t) => t.key === active);

  return (
    <div style={outerStyle} className="ahd-motion-slide-right">
      {/* Icon strip — always visible. */}
      <div style={stripStyle}>
        {tabs.map((t) => {
          const isActive = active === t.key && !collapsed;
          return (
            <button
              key={t.key}
              onClick={() => handleIconClick(t.key)}
              style={{
                ...iconButtonStyle,
                ...(isActive ? iconButtonActiveStyle : null),
              }}
              className="ahd-press"
              title={t.label}
              aria-current={isActive}
              aria-label={
                collapsed
                  ? `Expand ${t.label}`
                  : isActive
                  ? `Collapse ${t.label}`
                  : `Switch to ${t.label}`
              }
            >
              <span style={iconWrapStyle}>{t.icon}</span>
              <span style={iconLabelStyle}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Expanded panel — only rendered when !collapsed. */}
      {!collapsed && (
        <div
          style={{ ...panelStyle, width: panelWidth }}
          className="ahd-motion-fade-in"
        >
          <div style={panelHeaderStyle}>
            <div style={panelTitleStyle}>{activeTab?.label ?? ""}</div>
            <button
              onClick={() => onCollapsedChange(true)}
              style={panelCloseStyle}
              className="ahd-press"
              aria-label="Collapse panel"
              title="Collapse"
            >
              <CloseIcon />
            </button>
          </div>
          <div style={panelBodyStyle}>
            {/*
              Every panel stays mounted at all times so local state (order
              threads, advisor suggestions, chat scroll positions) survives
              tab switches. The active one is flex-laid-out so children that
              use flex:1 / overflow:auto (Orders queue, Diplomacy message
              list) can scroll. Inactive ones are display:none.
            */}
            {tabs.map((t) => (
              <div
                key={t.key}
                style={{
                  display: active === t.key ? "flex" : "none",
                  flexDirection: "column",
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                }}
              >
                {panels[t.key]}
              </div>
            ))}
          </div>
          {/* Right-edge resize handle. Hover shows a visible bar; otherwise
              just the cursor change indicates resizability. */}
          <div
            style={resizeHandleStyle}
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            title="Drag to resize"
          />
        </div>
      )}
    </div>
  );
}

const STRIP_WIDTH = 64;

const outerStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  bottom: 12,
  display: "flex",
  alignItems: "stretch",
  gap: 0,
  zIndex: 11,
  pointerEvents: "none",
};

const stripStyle: React.CSSProperties = {
  width: STRIP_WIDTH,
  flex: `0 0 ${STRIP_WIDTH}px`,
  background:
    "linear-gradient(180deg, rgba(20, 23, 30, 0.96), rgba(15, 17, 21, 0.96))",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow:
    "0 16px 40px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 6px",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  pointerEvents: "auto",
};

const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
  padding: "8px 2px",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  color: "var(--fg-muted)",
  fontFamily: "inherit",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  width: "100%",
};

const iconButtonActiveStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  borderColor: "var(--border-strong)",
  color: "var(--fg)",
  boxShadow: "0 1px 0 rgba(255, 255, 255, 0.04) inset",
};

const iconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  fontSize: "1.4em",
  lineHeight: 0,
};

const iconLabelStyle: React.CSSProperties = {
  lineHeight: 1,
};

const panelStyle: React.CSSProperties = {
  position: "relative",
  marginLeft: 8,
  background:
    "linear-gradient(180deg, rgba(20, 23, 30, 0.96), rgba(15, 17, 21, 0.96))",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow:
    "0 16px 40px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  minWidth: MIN_PANEL_WIDTH,
  maxWidth: MAX_PANEL_WIDTH,
  pointerEvents: "auto",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  flex: "0 0 auto",
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const panelCloseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  color: "var(--fg-muted)",
};

const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  padding: "12px 14px 14px",
};

const resizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  right: -3,
  top: 0,
  bottom: 0,
  width: 6,
  cursor: "ew-resize",
  background: "transparent",
  zIndex: 2,
};
