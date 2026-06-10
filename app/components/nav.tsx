import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

export async function Nav() {
  const session = await auth();
  const email = session?.user?.email;

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <header className="relative border-b">
      <nav className="container mx-auto flex items-center gap-2 px-4 py-3 text-sm md:gap-4 md:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Cashight
        </Link>

        {/* Desktop links */}
        <div className="ml-4 hidden items-center gap-1 md:flex">
          <NavLinks />
        </div>

        {/* Desktop account cluster */}
        <div className="ml-auto hidden items-center gap-3 md:flex">
          {email ? (
            <>
              <span className="max-w-[16rem] truncate text-muted-foreground">
                {email}
              </span>
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : null}
          <ThemeToggle />
        </div>

        {/* Mobile cluster */}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <MobileNav email={email} signOutAction={signOutAction} />
        </div>
      </nav>
    </header>
  );
}
