import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "./Icons";
import { setThemePreference, THEME_PREFERENCES, useResolvedTheme, useThemePreference } from "../theme.ts";
import type { ThemePreference } from "../theme.ts";
import "./ThemeToggle.css";

const OPTIONS: Record<ThemePreference, { label: string; Icon: typeof SunIcon }> = {
  system: { label: "System", Icon: MonitorIcon },
  light: { label: "Light", Icon: SunIcon },
  dark: { label: "Dark", Icon: MoonIcon },
};

/** Keep at least this much room between an open menu and the viewport edge. */
const EDGE_GAP = 8;

interface ThemeToggleProps {
  /** "outlined" matches the site's pill buttons, "plain" the editor's icon buttons. */
  variant?: "outlined" | "plain";
}

/**
 * Colour theme picker: an icon button (sun or moon, for the theme shown) that
 * opens a menu of System, Light and Dark with radio semantics. Keyboard
 * behaviour follows the editor's menus — arrows, Home/End, Escape returns to
 * the button, Tab moves on — and the choice persists across visits.
 */
export default function ThemeToggle({ variant = "outlined" }: ThemeToggleProps) {
  const preference = useThemePreference();
  const resolved = useResolvedTheme();
  const [open, setOpen] = useState(false);
  const [alignStart, setAlignStart] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);

  // The menu hangs from the button's right edge; near the left edge of a
  // narrow screen it would run off-screen, so it hangs from the left instead.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!open || !button || !menu) return;
    setAlignStart(button.getBoundingClientRect().right - menu.offsetWidth < EDGE_GAP);
  }, [open]);

  // Opening moves focus to the current choice, as a radio group would.
  useEffect(() => {
    if (!open) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, [open]);

  // A press anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (refocusButton: boolean) => {
    setOpen(false);
    if (refocusButton) buttonRef.current?.focus();
  };

  const choose = (value: ThemePreference) => {
    setThemePreference(value);
    close(true);
  };

  // Focus leaving the control (Tab, a click elsewhere) closes the menu.
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && !(next instanceof Node && wrapRef.current?.contains(next))) setOpen(false);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const items = menuItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (target: number) => items[(target + items.length) % items.length].focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        // Hand focus back to the button and let the browser move on from
        // there, so Tab and Shift+Tab leave the control in page order.
        close(true);
        break;
      default:
        break;
    }
  };

  const ShownIcon = resolved === "dark" ? MoonIcon : SunIcon;
  const summary = preference === "system" ? `System (${resolved})` : OPTIONS[preference].label;

  return (
    <div ref={wrapRef} className={`theme-toggle theme-toggle--${variant}`} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="theme-toggle-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Colour theme: ${summary}`}
        title={`Colour theme: ${summary}`}
        // Keep focus where it is on press (Safari does not focus buttons on
        // click, which would otherwise read as focus leaving the control).
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ShownIcon size={18} />
      </button>
      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Colour theme"
          className={`theme-toggle-menu${alignStart ? " theme-toggle-menu--start" : ""}`}
          onKeyDown={onMenuKeyDown}
        >
          {THEME_PREFERENCES.map((value) => {
            const { label, Icon } = OPTIONS[value];
            return (
              <li key={value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={preference === value}
                  // Arrow keys move between items; Tab leaves the menu.
                  tabIndex={-1}
                  className="theme-toggle-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(value)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <CheckIcon size={14} className="theme-toggle-check" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
