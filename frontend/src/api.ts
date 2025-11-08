const BACKEND_URL = "http://localhost:8080";

interface ApiOptions extends RequestInit {
  method?: string;
  // Permite que o body seja um objeto que será serializado para JSON
  body?: BodyInit | object; 
}

/**
 * Cliente de API customizado que adiciona o token JWT em requisições
 * para endpoints restritos.
 */
export async function api(endpoint: string, options: ApiOptions = {}) {
  const token = localStorage.getItem("token");
  const headers = options.headers || {};
  
  // Se houver um token, inclua-o no header Authorization
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let body = options.body;
  // Se o body for um objeto (e não FormData, Blob, etc.), serializa para JSON
  if (typeof options.body === 'object' && options.body !== null && !(options.body instanceof FormData)) {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }

  const url = `${BACKEND_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: headers as HeadersInit,
      body: body as BodyInit,
    });

    // Tenta ler a resposta JSON. Se falhar, assume um objeto vazio.
    const data = await response.json().catch(() => ({}));

    // 401 ou 403 (Token inválido, expirado ou ausente)
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("token");
        // Isso força o App.tsx a re-renderizar para o estado de "não logado" (tela de login)
        alert("Sua sessão expirou ou o acesso foi negado. Por favor, faça login novamente.");
        window.location.reload(); 
        
        return { ok: false, error: "Token inválido/expirado." };
    }
    
    // Se a API retornar um status de erro (como 409), retorna o objeto de erro
    if (!response.ok) {
        return { ok: false, error: data.error || `Erro na API: ${response.status}` };
    }
    
    return { ok: response.ok, ...data };

  } catch (e) {
    console.error("API Fetch Error:", e);
    return { ok: false, error: "Falha na comunicação com o servidor. Verifique o console." };
  }
}