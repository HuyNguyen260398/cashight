import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Cashight</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to track your spending.
        </p>
        {error ? (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error === "AccessDenied"
              ? "That account isn't allowed to access this app."
              : "Couldn't sign you in. Please try again."}
          </p>
        ) : null}
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" className="w-full">Sign in with Google</Button>
        </form>
        <form
          className="mt-3"
          action={async () => {
            "use server";
            await signIn("cognito", { redirectTo: "/" });
          }}
        >
          <Button type="submit" variant="outline" className="w-full">
            Sign in with Cognito
          </Button>
        </form>
      </div>
    </main>
  );
}
