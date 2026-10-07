import { LoginForm } from "@client/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="text-caption uppercase tracking-[0.2em] text-muted-foreground">Cadence</p>
          <h1 className="text-title font-semibold">Sign in</h1>
          <p className="text-small text-muted-foreground">Accounts are by invitation.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
