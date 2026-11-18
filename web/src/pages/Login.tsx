import { product } from '../product.js';

// Sign-on goes through Medhanta core: the button sends the browser to core's sign-in page.
export function Login() {
  return (
    <main className="page narrow login">
      <img className="login-logo" src="/truebatch-logo.png" alt="TrueBatch" />
      <h1>{product.name}</h1>
      <p className="muted">{product.about} Sign in with your own Medhanta login.</p>
      <div className="card">
        <a className="button primary" href="/login">Sign in</a>
      </div>
    </main>
  );
}
