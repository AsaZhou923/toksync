export default function LoginPage() {
  return (
    <div className="grid">
      <h1>Login</h1>
      <p className="lede">
        Development mode uses the `demo` local user. GitHub OAuth is reserved
        for hosted deployment.
      </p>
      <a className="btn primary" href="/app">
        Continue as demo
      </a>
    </div>
  );
}
