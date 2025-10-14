export const API_URL = `http://${location.hostname}:8080`;

/**
 * Função genérica de requisições para o backend da Arena.
 * Inclui o token JWT automaticamente quando o usuário estiver logado.
 */
export async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("token");

  // Monta headers padrão
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };

  // Se estiver logado, adiciona o token no header
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Executa a requisição
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  // Caso o token tenha expirado ou seja inválido
  if (res.status === 401 || res.status === 403) {
    console.warn("⚠️ Token inválido ou expirado. Deslogando usuário...");
    localStorage.removeItem("token");
    // Opcional: força logout automático e reload
    window.location.href = "/";
    return;
  }

  // Retorna o JSON normalmente
  return res.json();
}
