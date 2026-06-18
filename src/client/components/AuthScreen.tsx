import { LogIn, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";

type AuthScreenProps = {
  onSubmit: (mode: "login" | "register", username: string, password: string) => Promise<void>;
  error: string;
};

export function AuthScreen({ onSubmit, error }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(mode, username, password).finally(() => setBusy(false));
  }

  return (
    <main className="auth-screen">
      <section className="auth-hero">
        <div className="brand-mark"><Sparkles size={28} /> AnimeGame</div>
        <h1>AnimeGame</h1>
        <p>3D life-sim: дом, одежда, питомцы, гости, чат и первые online-прогулки.</p>
      </section>
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="segmented">
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button>
        </div>
        <label>
          Ник
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Rodion" autoComplete="username" />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="минимум 6 символов" type="password" autoComplete="current-password" />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-button" disabled={busy}>
          <LogIn size={18} />
          {busy ? "Подключаем..." : mode === "register" ? "Создать персонажа" : "Войти домой"}
        </button>
      </form>
    </main>
  );
}

