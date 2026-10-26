/**
 * Small UI primitives for the paper editor: a modal dialog, menus with full
 * keyboard support (the File/Edit/Insert menu bar and toolbar dropdowns), and
 * toolbar buttons.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { useOutsideClose } from "./useOutsideClose.ts";

// ── Dialog ──────────────────────────────────────────────────────────────────

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Optional id of the element to focus when the dialog opens. */
  initialFocusId?: string;
}

/**
 * A native modal <dialog>: the browser makes the page behind it inert, traps
 * focus and handles Escape. Focus returns to where it was on close.
 */
export function Dialog({ title, onClose, children, footer, size = "md", initialFocusId }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    if (initialFocusId) document.getElementById(initialFocusId)?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, [initialFocusId]);

  return (
    <dialog
      ref={ref}
      className={`write-dialog write-dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onCloseRef.current();
      }}
    >
      <div className="write-dialog-panel">
        <header className="write-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="write-icon-button" aria-label="Close" onClick={() => onCloseRef.current()}>
            <Icon name="close" />
          </button>
        </header>
        <div className="write-dialog-body">{children}</div>
        {footer && <footer className="write-dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

// ── Menus ───────────────────────────────────────────────────────────────────

export interface MenuAction {
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  icon?: IconName;
  disabled?: boolean;
  /** Renders as a checkable item (menuitemcheckbox / radio-like state). */
  checked?: boolean;
  /** A colour dot shown instead of an icon (text and highlight colours). */
  swatch?: string;
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuAction | "separator";

function isAction(entry: MenuEntry): entry is MenuAction {
  return entry !== "separator";
}

interface MenuListProps {
  items: MenuEntry[];
  onClose: (refocusTrigger: boolean) => void;
  label: string;
  align?: "start" | "end";
  /** Moves to the neighbouring top-level menu (menu bar only). */
  onNavigate?: (direction: 1 | -1) => void;
  nested?: boolean;
}

export function MenuList({ items, onClose, label, align = "start", onNavigate, nested = false }: MenuListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  const focusable = useCallback(() => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button:not(:disabled)") ?? []), []);

  useEffect(() => {
    focusable()[0]?.focus();
  }, [focusable]);

  const move = (delta: number) => {
    const buttons = focusable();
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + delta + buttons.length) % buttons.length].focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.target instanceof HTMLElement && !listRef.current?.contains(event.target)) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        focusable()[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        focusable().slice(-1)[0]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        break;
      case "ArrowLeft":
        if (nested) {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        } else if (onNavigate) {
          event.preventDefault();
          onNavigate(-1);
        }
        break;
      case "ArrowRight":
        if (onNavigate && !(document.activeElement as HTMLElement | null)?.hasAttribute("aria-haspopup")) {
          event.preventDefault();
          onNavigate(1);
        }
        break;
      case "Tab":
        onClose(false);
        break;
      default:
        break;
    }
  };

  return (
    <ul ref={listRef} role="menu" aria-label={label} className={`write-menu write-menu--${align}${nested ? " write-menu--nested" : ""}`} onKeyDown={onKeyDown}>
      {items.map((entry, index) => {
        if (!isAction(entry)) return <li key={`sep-${index}`} role="separator" className="write-menu-separator" />;
        const hasSubmenu = Boolean(entry.submenu?.length);
        return (
          <li key={`${entry.label}-${index}`} role="none" className="write-menu-item-wrap" onMouseEnter={() => setOpenSubmenu(hasSubmenu ? index : null)}>
            <button
              type="button"
              role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={entry.checked === undefined ? undefined : entry.checked}
              aria-haspopup={hasSubmenu ? "menu" : undefined}
              aria-expanded={hasSubmenu ? openSubmenu === index : undefined}
              className="write-menu-item"
              disabled={entry.disabled}
              onClick={() => {
                if (hasSubmenu) {
                  setOpenSubmenu(openSubmenu === index ? null : index);
                  return;
                }
                onClose(true);
                entry.onSelect?.();
              }}
              onKeyDown={(event) => {
                if (hasSubmenu && (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenSubmenu(index);
                }
              }}
            >
              <span className="write-menu-check" aria-hidden="true">
                {entry.checked ? (
                  <Icon name="check" size={15} />
                ) : entry.swatch ? (
                  <span className="write-menu-swatch" style={{ background: entry.swatch }} />
                ) : entry.icon ? (
                  <Icon name={entry.icon} size={15} />
                ) : null}
              </span>
              <span className="write-menu-label">{entry.label}</span>
              {entry.shortcut && <kbd className="write-menu-shortcut">{entry.shortcut}</kbd>}
              {hasSubmenu && <Icon name="chevronDown" size={14} className="write-menu-chevron" />}
            </button>
            {hasSubmenu && openSubmenu === index && entry.submenu && (
              <MenuList
                items={entry.submenu}
                label={entry.label}
                nested
                onClose={(refocus) => {
                  setOpenSubmenu(null);
                  if (refocus) {
                    const buttons = focusable();
                    buttons.find((button) => button.textContent?.startsWith(entry.label))?.focus();
                  } else onClose(false);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface MenuBarProps {
  menus: { label: string; items: MenuEntry[] }[];
  label: string;
}

/** A desktop-style menu bar: click to open, hover to switch, arrows to move. */
export function MenuBar({ menus, label }: MenuBarProps) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const close = useCallback(() => setOpen(null), []);
  useOutsideClose(open !== null, close, barRef);

  const focusTop = (index: number) => buttons.current[(index + menus.length) % menus.length]?.focus();

  return (
    <div ref={barRef} role="menubar" aria-label={label} className="write-menubar">
      {menus.map((menu, index) => (
        <div key={menu.label} className="write-menubar-item">
          <button
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === index}
            className="write-menubar-button"
            onClick={() => setOpen(open === index ? null : index)}
            onMouseEnter={() => {
              if (open !== null && open !== index) setOpen(index);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusTop(index + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusTop(index - 1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(index);
              }
            }}
          >
            {menu.label}
          </button>
          {open === index && (
            <MenuList
              items={menu.items}
              label={menu.label}
              onNavigate={(direction) => {
                const next = (index + direction + menus.length) % menus.length;
                setOpen(next);
              }}
              onClose={(refocus) => {
                setOpen(null);
                if (refocus) buttons.current[index]?.focus();
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface MenuButtonProps {
  label: string;
  items: MenuEntry[];
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  title?: string;
}

/** A toolbar button that opens a menu (paragraph style, zoom, export…). */
export function MenuButton({ label, items, children, className = "", align = "start", title }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, close, wrapRef);
  return (
    <div ref={wrapRef} className="write-menubutton">
      <button
        ref={buttonRef}
        type="button"
        className={`write-tool write-tool--menu ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
        <Icon name="chevronDown" size={14} className="write-tool-chevron" />
      </button>
      {open && (
        <MenuList
          items={items}
          label={label}
          align={align}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

interface ToolButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

/**
 * A toolbar button. It keeps the editor's selection: mousedown is prevented
 * so focus never leaves the document while formatting.
 */
export function ToolButton({ icon, label, onClick, active, disabled, shortcut }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="write-tool"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export function ToolSeparator() {
  return <span className="write-tool-separator" role="separator" aria-orientation="vertical" />;
}
