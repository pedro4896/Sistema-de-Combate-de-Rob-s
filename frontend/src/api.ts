export const API_URL = `http://${location.hostname}:8080`;
export async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  return res.json();
}
