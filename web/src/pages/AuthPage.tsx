import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api.js";

export function AuthPage({ mode }: { mode: "signup" | "login" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const submit = useMutation({
    mutationFn: mode === "signup" ? api.signUp : api.logIn,
    onSuccess: (me) => {
      queryClient.setQueryData(["me"], me);
      void navigate("/");
    },
  });
  const isSignUp = mode === "signup";

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit.mutate({ email, password });
  }

  return (
    <main className="page narrow">
      <h1>{isSignUp ? "Create your account" : "Log in"}</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={isSignUp ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {submit.isError && <p className="error">{submit.error.message}</p>}
        <button type="submit" disabled={submit.isPending}>
          {isSignUp ? "Sign up" : "Log in"}
        </button>
      </form>
      <p>
        {isSignUp ? (
          <>
            Already have an account? <Link to="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link to="/signup">Create an account</Link>
          </>
        )}
      </p>
    </main>
  );
}
