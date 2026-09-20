import { FormEvent, lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { StudioBrand } from "@/components/studio-brand";
import { supabase, supabaseConfigured } from "@/lib/supabase";

const StudioDashboard = lazy(() => import("@/features/studio/studio-dashboard").then((module) => ({ default: module.StudioDashboard })));
const isTestEnvironment = import.meta.env.VITE_APP_ENV === "test";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveringPassword, setRecoveringPassword] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setRecoveringPassword(true);
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <SetupNotice />;
  if (loading) return <div className="auth-shell"><Loader2 className="auth-spinner" aria-label="Carregando" /></div>;
  if (!session) return <Login />;
  if (recoveringPassword) return <RecoveryPassword onDone={() => setRecoveringPassword(false)} />;

  return <Suspense fallback={<div className="auth-shell"><Loader2 className="auth-spinner" aria-label="Carregando painel" /></div>}><StudioDashboard userEmail={session.user.email ?? "Conta do studio"} onSignOut={() => void supabase.auth.signOut()} testEnvironment={isTestEnvironment} /></Suspense>;
}

function Login() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setSaving(true); setError(""); setMessage("");
    if (mode === "forgot") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}` });
      if (resetError) setError("Não foi possível enviar o e-mail agora. Tente novamente.");
      else setMessage("Se existir uma conta com esse e-mail, enviaremos um link para redefinir a senha.");
      setSaving(false);
      return;
    }
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
    if (result.error) setError(mode === "login" ? "E-mail ou senha incorretos." : result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Conta criada. Confirme o e-mail para entrar.");
    setSaving(false);
  };

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-identity">
      <StudioBrand inverted />
      <div className="auth-identity-copy"><strong>Seu studio organizado, todos os dias.</strong><p>Atendimentos, recebimentos e metas em um só lugar.</p></div>
    </div>
    <div className="auth-panel">
      {isTestEnvironment ? <span className="test-badge">V2 · Ambiente de testes</span> : null}
      <div className="auth-heading"><span><LockKeyhole /> Acesso protegido</span><h1>{mode === "login" ? "Entrar no studio" : mode === "signup" ? "Criar primeiro acesso" : "Recuperar acesso"}</h1><p>{mode === "forgot" ? "Informe o e-mail da conta para receber o link de recuperação." : "Use a mesma conta no celular e no computador."}</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">E-mail</label><input id="auth-email" name="email" type="email" autoComplete="email" required placeholder="studio@email.com" />
        {mode !== "forgot" ? <><label htmlFor="auth-password">Senha</label><input id="auth-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 12 : 6} required placeholder={mode === "signup" ? "Mínimo de 12 caracteres" : "Digite sua senha"} /></> : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}{message ? <p className="auth-success" role="status">{message}</p> : null}
        <button className="auth-submit" type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Sparkles />}{mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link de recuperação"}</button>
      </form>
      <div className="auth-secondary-actions">
        {mode === "login" ? <button className="auth-switch" type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Esqueci minha senha</button> : null}
        <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}>{mode === "login" ? "Ainda não tem acesso? Criar conta" : mode === "signup" ? "Já tem uma conta? Entrar" : "Voltar para entrar"}</button>
      </div>
    </div>
  </section></main>;
}

function RecoveryPassword({ onDone }: { onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) { setError("As duas senhas precisam ser iguais."); return; }
    setSaving(true); setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError("Não foi possível alterar a senha. Solicite um novo link e tente novamente."); setSaving(false); return; }
    await supabase.auth.signOut();
    onDone();
    setSaving(false);
  };

  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-identity"><StudioBrand inverted /><div className="auth-identity-copy"><strong>Crie uma senha segura.</strong><p>Use pelo menos 12 caracteres e evite informações fáceis de adivinhar.</p></div></div>
    <div className="auth-panel">
      {isTestEnvironment ? <span className="test-badge">V2 · Ambiente de testes</span> : null}
      <div className="auth-heading"><span><LockKeyhole /> Recuperação segura</span><h1>Definir nova senha</h1><p>Depois da alteração, entre novamente usando a nova senha.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="recovery-password">Nova senha</label><input id="recovery-password" name="password" type="password" autoComplete="new-password" minLength={12} required placeholder="Mínimo de 12 caracteres" />
        <label htmlFor="recovery-password-confirmation">Confirmar nova senha</label><input id="recovery-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} required placeholder="Digite novamente" />
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="auth-submit" type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Sparkles />}Alterar senha</button>
      </form>
    </div>
  </section></main>;
}

function SetupNotice() {
  return <main className="auth-shell"><section className="setup-card"><StudioBrand /><div className="auth-heading"><h1>Banco ainda não conectado</h1><p>Configure o projeto do Supabase para liberar o acesso.</p></div></section></main>;
}
