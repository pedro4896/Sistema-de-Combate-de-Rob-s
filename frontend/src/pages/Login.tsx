import React, { useState } from "react";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:8080/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Usuário ou senha incorretos");
        setLoading(false);
        return;
      }

      const data = await res.json();
      localStorage.setItem("token", data.token);
      setLoading(false);
      onLogin();
    } catch {
      setError("Erro ao conectar com o servidor");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#000814] to-[#001933] text-white">
      <div className="bg-black/50 p-10 rounded-2xl shadow-2xl w-80 border border-white/10 text-center">
        <h1 className="text-2xl font-extrabold text-arena-accent mb-6">
          Login do Administrador
        </h1>

        <form onSubmit={handleLogin} className="flex flex-col space-y-4">
          <input
            type="text"
            placeholder="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="p-2 rounded bg-white/10 border border-white/10 focus:outline-none focus:ring-2 focus:ring-arena-accent"
          />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="p-2 rounded bg-white/10 border border-white/10 focus:outline-none focus:ring-2 focus:ring-arena-accent"
          />

          {error && (
            <div className="bg-red-500/20 border border-red-400/40 text-red-300 text-sm rounded p-2">
              {error}
            </div>
          )}

          {/* Botão igual ao estilo da navbar */}
          <button
            type="submit"
            disabled={loading}
            className={`btn btn-accent font-bold text-black w-full ${
              loading ? "opacity-70 cursor-not-allowed" : "hover:opacity-90"
            }`}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-xs text-white/50">
          Acesso restrito ao administrador
        </p>
      </div>
    </div>
  );
}
