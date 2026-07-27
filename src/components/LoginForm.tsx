"use client";

import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type LoginResponse = {
  user?: { id: string };
  error?: string;
};

type SignupResponse = {
  message?: string;
  error?: string;
};

type Mode = "login" | "signup";

const emptySignup = {
  name: "",
  username: "",
  email: "",
  password: "",
  phone: "",
};

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signup, setSignup] = useState(emptySignup);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setSuccess("");
  }

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json()) as LoginResponse;

      if (!response.ok || !data.user) {
        setError(data.error ?? "Não foi possível entrar.");
        return;
      }

      // Todos os perfis caem no mesmo painel; as abas e que variam por perfil.
      router.replace("/painel");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function onSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup),
      });

      const data = (await response.json()) as SignupResponse;

      if (!response.ok) {
        setError(data.error ?? "Não foi possível enviar a solicitação.");
        return;
      }

      setSignup(emptySignup);
      setMode("login");
      setSuccess(data.message ?? "Solicitação enviada.");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "signup") {
    return (
      <form className="form-grid" onSubmit={onSignup}>
        <div className="field">
          <label htmlFor="signup-name">Nome completo</label>
          <input
            className="input"
            id="signup-name"
            value={signup.name}
            onChange={(event) => setSignup({ ...signup, name: event.target.value })}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-username">Usuário</label>
          <input
            className="input"
            id="signup-username"
            value={signup.username}
            onChange={(event) => setSignup({ ...signup, username: event.target.value })}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-email">E-mail</label>
          <input
            className="input"
            id="signup-email"
            type="email"
            value={signup.email}
            onChange={(event) => setSignup({ ...signup, email: event.target.value })}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="signup-phone">Telefone (opcional)</label>
          <input
            className="input"
            id="signup-phone"
            value={signup.phone}
            onChange={(event) => setSignup({ ...signup, phone: event.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="signup-password">Senha</label>
          <input
            className="input"
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={signup.password}
            onChange={(event) => setSignup({ ...signup, password: event.target.value })}
            required
          />
        </div>

        {error ? <div className="alert error" role="alert">{error}</div> : null}

        <button className="button" type="submit" disabled={loading}>
          <UserPlus size={16} />
          {loading ? "Enviando..." : "Solicitar acesso"}
        </button>

        <button
          className="button ghost"
          type="button"
          onClick={() => switchMode("login")}
          disabled={loading}
        >
          Já tenho acesso
        </button>
      </form>
    );
  }

  return (
    <form className="form-grid" onSubmit={onLogin}>
      <div className="field">
        <label htmlFor="username">Usuário</label>
        <input
          className="input"
          id="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Senha</label>
        <div className="password-input">
          <input
            className="input"
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            className="password-visibility-button"
            type="button"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {success ? <div className="alert success" role="status">{success}</div> : null}

      <button className="button" type="submit" disabled={loading}>
        <LogIn size={16} />
        {loading ? "Entrando..." : "Entrar"}
      </button>

      <button
        className="button ghost"
        type="button"
        onClick={() => switchMode("signup")}
        disabled={loading}
      >
        Solicitar acesso
      </button>
    </form>
  );
}
