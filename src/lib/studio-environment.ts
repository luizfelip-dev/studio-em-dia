const TEST_PROJECT_HOST = "qwcxjaldvehwgfnozaby.supabase.co";

export function supabaseConnectSources(rawUrl = "", appEnvironment = "") {
  if (!rawUrl.trim()) {
    if (appEnvironment === "test") throw new Error("Configure o Supabase separado antes de iniciar os testes.");
    return "'self'";
  }
  const url = new URL(rawUrl.trim());
  if (url.protocol !== "https:" || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Endereço do Supabase inválido para este ambiente.");
  }
  if (appEnvironment === "test" && url.hostname !== TEST_PROJECT_HOST) {
    throw new Error("O ambiente de testes só pode acessar o projeto V2 Testes.");
  }
  return `'self' ${url.origin} wss://${url.hostname}`;
}
