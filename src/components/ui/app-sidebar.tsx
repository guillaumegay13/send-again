import Link from "next/link";
import { ReactNode } from "react";

export interface AppSidebarNavItem {
  id: string;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}

interface AppSidebarProps {
  brand: string;
  userEmail?: string | null;
  onSignOut?: () => void;
  authError?: string | null;
  controls?: ReactNode;
  items: AppSidebarNavItem[];
  footer?: ReactNode;
}

function navState(active?: boolean): "true" | "false" {
  return active ? "true" : "false";
}

export function AppSidebar({
  brand,
  userEmail,
  onSignOut,
  authError,
  controls,
  items,
  footer,
}: AppSidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-brand">
        <span>{brand}</span>
      </div>

      {(userEmail || onSignOut || authError) && (
        <div className="app-sidebar-account">
          {userEmail ? <p className="text-xs text-gray-500 truncate">{userEmail}</p> : null}
          {onSignOut ? (
            <button type="button" onClick={onSignOut} className="mt-1 text-xs text-black hover:underline">
              Sign out
            </button>
          ) : null}
          {authError ? <p className="mt-2 text-[11px] text-red-600">{authError}</p> : null}
        </div>
      )}

      {controls ? <div>{controls}</div> : null}

      <nav className="app-sidebar-nav">
        {items.map((item) => {
          const state = navState(item.active);

          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                data-active={state}
                className="app-nav-item"
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              data-active={state}
              className="app-nav-item"
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {footer ? <div className="app-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}
