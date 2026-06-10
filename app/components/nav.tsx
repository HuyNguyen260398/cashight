import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LinkLoadingOverlay } from "./link-loading-overlay";
import { ThemeToggle } from "./theme-toggle";

export async function Nav() {
  const session = await auth();
  const email = session?.user?.email;

  return (
    <header className="border-b">
      <nav className="container mx-auto flex flex-wrap items-center gap-4 px-4 py-3 text-sm md:px-6">
        <Link href="/" className="font-medium hover:underline">
          Dashboard
          <LinkLoadingOverlay />
        </Link>
        <Link href="/upload" className="hover:underline">
          Upload
          <LinkLoadingOverlay />
        </Link>
        <Link href="/statements" className="hover:underline">
          Statements
          <LinkLoadingOverlay />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {email ? (
            <>
              <span className="text-muted-foreground">{email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/signin" });
                }}
              >
                <Button type="submit" variant="ghost" size="sm">Sign out</Button>
              </form>
            </>
          ) : null}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
