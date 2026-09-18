"use client";

import { useEffect, useState } from "react";
import { isInstalledPwa, isIosDevice } from "@/lib/pwa-client";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallHint() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const isStandalone = isInstalledPwa();
    const updateDisplayState = window.setTimeout(() => {
      setStandalone(isStandalone);
      setIos(isIosDevice() && !isStandalone);
    }, 0);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.clearTimeout(updateDisplayState);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  if (standalone) return null;
  if (installEvent) {
    return (
      <aside className="notas-install-hint">
        <span>Instale no celular para guardar suas fotos com mais segurança.</span>
        <button
          className="button secondary"
          type="button"
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice;
            setInstallEvent(null);
          }}
        >
          Instalar
        </button>
      </aside>
    );
  }
  if (ios) {
    return (
      <aside className="notas-install-hint">
        No iPhone, toque em Compartilhar e depois em <strong>Adicionar à Tela de Início</strong>.
      </aside>
    );
  }
  return null;
}
