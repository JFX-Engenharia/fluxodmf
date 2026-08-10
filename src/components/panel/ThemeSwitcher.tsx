"use client";

import { Accessibility, Contrast, Type, ZapOff } from "lucide-react";
import { useEffect, useState } from "react";

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

type AccessibilityId = (typeof accessibilityOptions)[number]["id"];
type AccessibilityPreferences = Record<AccessibilityId, boolean>;

const accessibilityStorageKey = "fluxo-accessibility";
const defaultAccessibility: AccessibilityPreferences = {
  contrast: false,
  largeText: false,
  reducedMotion: false,
};

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

export function AccessibilityMenu() {
  const [accessibility, setAccessibility] =
    useState<AccessibilityPreferences>(defaultAccessibility);

  useEffect(() => {
    const savedAccessibility = readAccessibility(localStorage.getItem(accessibilityStorageKey));
    applyAccessibility(savedAccessibility);
    const frame = requestAnimationFrame(() => setAccessibility(savedAccessibility));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleAccessibility(id: AccessibilityId) {
    const nextAccessibility = { ...accessibility, [id]: !accessibility[id] };
    setAccessibility(nextAccessibility);
    setAccessibilityAttribute(id, nextAccessibility[id]);
    localStorage.setItem(accessibilityStorageKey, JSON.stringify(nextAccessibility));
  }

  return (
    <section className="preference-section account-accessibility" aria-labelledby="accessibility-title">
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
  );
}
