"use client";

import { Accessibility, Check, Contrast, Moon, Palette, Sun, Type, X, ZapOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const themes = [
  { id: "violet", label: "Violeta", color: "#6d28d9" },
  { id: "ocean", label: "Oceano", color: "#0369a1" },
  { id: "forest", label: "Floresta", color: "#047857" },
  { id: "sunset", label: "Pôr do sol", color: "#c2410c" },
  { id: "rose", label: "Rosa", color: "#be185d" },
  { id: "indigo", label: "Índigo", color: "#4f46e5" },
  { id: "teal", label: "Turquesa", color: "#0f766e" },
  { id: "gold", label: "Dourado", color: "#a16207" },
] as const;

const modeOptions = [
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Escuro", Icon: Moon },
] as const;

const accessibilityOptions = [
  {
    id: "contrast",
    label: "Alto contraste",
    description: "Reforça bordas, textos e foco.",
    Icon: Contrast,
  },
  {
    id: "largeText",
    label: "Texto ampliado",
    description: "Aumenta textos e controles.",
    Icon: Type,
  },
  {
    id: "reducedMotion",
    label: "Reduzir animações",
    description: "Remove transições e movimentos.",
    Icon: ZapOff,
  },
] as const;

type ThemeId = (typeof themes)[number]["id"];
type ColorMode = (typeof modeOptions)[number]["id"];
type AccessibilityId = (typeof accessibilityOptions)[number]["id"];
type AccessibilityPreferences = Record<AccessibilityId, boolean>;

const themeStorageKey = "fluxo-theme";
const modeStorageKey = "fluxo-color-mode";
const accessibilityStorageKey = "fluxo-accessibility";
const defaultAccessibility: AccessibilityPreferences = {
  contrast: false,
  largeText: false,
  reducedMotion: false,
};

function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

function isColorMode(value: string | null): value is ColorMode {
  return modeOptions.some((mode) => mode.id === value);
}

function readAccessibility(value: string | null): AccessibilityPreferences {
  if (!value) return defaultAccessibility;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return defaultAccessibility;
    return {
      contrast: "contrast" in parsed && parsed.contrast === true,
      largeText: "largeText" in parsed && parsed.largeText === true,
      reducedMotion: "reducedMotion" in parsed && parsed.reducedMotion === true,
    };
  } catch {
    return defaultAccessibility;
  }
}

function setAccessibilityAttribute(name: AccessibilityId, active: boolean) {
  const attribute = `data-a11y-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  if (active) document.documentElement.setAttribute(attribute, "true");
  else document.documentElement.removeAttribute(attribute);
}

function applyAccessibility(preferences: AccessibilityPreferences) {
  accessibilityOptions.forEach((option) => {
    setAccessibilityAttribute(option.id, preferences[option.id]);
  });
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>("violet");
  const [mode, setMode] = useState<ColorMode>("light");
  const [accessibility, setAccessibility] =
    useState<AccessibilityPreferences>(defaultAccessibility);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(themeStorageKey);
    const savedMode = localStorage.getItem(modeStorageKey);
    const savedAccessibility = readAccessibility(localStorage.getItem(accessibilityStorageKey));
    const nextTheme = isThemeId(savedTheme) ? savedTheme : "violet";
    const nextMode = isColorMode(savedMode) ? savedMode : "light";

    document.documentElement.setAttribute("data-theme", nextTheme);
    document.documentElement.setAttribute("data-mode", nextMode);
    applyAccessibility(savedAccessibility);

    const frame = requestAnimationFrame(() => {
      setTheme(nextTheme);
      setMode(nextMode);
      setAccessibility(savedAccessibility);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectTheme(nextTheme: ThemeId) {
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem(themeStorageKey, nextTheme);
  }

  function selectMode(nextMode: ColorMode) {
    setMode(nextMode);
    document.documentElement.setAttribute("data-mode", nextMode);
    localStorage.setItem(modeStorageKey, nextMode);
  }

  function toggleAccessibility(id: AccessibilityId) {
    const nextAccessibility = { ...accessibility, [id]: !accessibility[id] };
    setAccessibility(nextAccessibility);
    setAccessibilityAttribute(id, nextAccessibility[id]);
    localStorage.setItem(accessibilityStorageKey, JSON.stringify(nextAccessibility));
  }

  return (
    <div className="theme-switcher" ref={root}>
      <button
        className="theme-trigger"
        type="button"
        aria-label="Personalizar aparência e acessibilidade"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Palette size={18} />
        <span>Aparência</span>
      </button>

      {open ? (
        <div className="theme-menu" role="dialog" aria-modal="false" aria-labelledby="appearance-title">
          <div className="theme-menu-header">
            <div>
              <strong id="appearance-title">Aparência e acessibilidade</strong>
              <small>As preferências ficam salvas neste dispositivo.</small>
            </div>
            <button className="icon-button" type="button" aria-label="Fechar aparência" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <section className="preference-section" aria-labelledby="color-mode-title">
            <span className="preference-title" id="color-mode-title">Modo</span>
            <div className="appearance-modes">
              {modeOptions.map(({ id, label, Icon }) => (
                <button
                  className="appearance-mode"
                  type="button"
                  aria-pressed={mode === id}
                  key={id}
                  onClick={() => selectMode(id)}
                >
                  <Icon size={17} />
                  {label}
                  {mode === id ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="preference-section" aria-labelledby="color-theme-title">
            <span className="preference-title" id="color-theme-title">Cor principal</span>
            <div className="theme-options">
              {themes.map((item) => (
                <button
                  className="theme-option"
                  type="button"
                  role="radio"
                  aria-checked={theme === item.id}
                  key={item.id}
                  onClick={() => selectTheme(item.id)}
                >
                  <span className="theme-swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span>{item.label}</span>
                  {theme === item.id ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="preference-section" aria-labelledby="accessibility-title">
            <span className="preference-title" id="accessibility-title">
              <Accessibility size={15} />
              Acessibilidade
            </span>
            <div className="accessibility-options">
              {accessibilityOptions.map(({ id, label, description, Icon }) => (
                <button
                  className="accessibility-option"
                  type="button"
                  role="switch"
                  aria-checked={accessibility[id]}
                  key={id}
                  onClick={() => toggleAccessibility(id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <span className="preference-switch" aria-hidden="true">
                    <span />
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
