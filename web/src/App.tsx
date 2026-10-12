import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from "react-router";
import { api } from "./api.js";
import { AuthPage } from "./pages/AuthPage.js";
import { CvListPage } from "./pages/CvListPage.js";
import { CvPage } from "./pages/CvPage.js";
import { NewCvPage } from "./pages/NewCvPage.js";

export function App() {
  return (
    <Routes>
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route element={<SignedIn />}>
        <Route path="/" element={<CvListPage />} />
        <Route path="/cvs/new" element={<NewCvPage />} />
        <Route path="/cvs/:id" element={<CvPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SignedIn() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logOut = useMutation({
    mutationFn: api.logOut,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/login");
    },
  });

  if (me.isPending) return <p className="page">Loading…</p>;
  if (me.isError) return <p className="page error">{me.error.message}</p>;
  if (me.data === null) return <Navigate to="/login" replace />;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          AI CV Builder
        </Link>
        <span className="who">{me.data.email}</span>
        <button type="button" className="link" onClick={() => logOut.mutate()}>
          Log out
        </button>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
