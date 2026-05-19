export default function LoginPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  return (
    <div className="grid">
      <h1>Login</h1>
      <p className="lede">
        Hosted TokSync uses GitHub OAuth first. Development mode can still use
        the local `demo` user.
      </p>
      <a className="btn primary" href={`${apiUrl}/v1/auth/github/start`}>
        Continue with GitHub
      </a>
      <a className="btn" href="/app">
        Continue as demo
      </a>
    </div>
  );
}
