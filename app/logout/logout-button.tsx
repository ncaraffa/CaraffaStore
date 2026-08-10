import { Button } from "@/components/ui/Button";

export function LogoutButton() {
  return (
    <form action="/logout" method="post">
      <Button type="submit" variant="ghost" size="sm">
        Sair
      </Button>
    </form>
  );
}
