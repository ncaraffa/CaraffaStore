export function LogoutButton() {
  return (
    <form action="/logout" method="post" className="auth-links">
      <button type="submit">Sair</button>
    </form>
  );
}
