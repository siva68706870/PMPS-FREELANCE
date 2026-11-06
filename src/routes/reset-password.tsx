import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — PMPS Freelance" },
      { name: "description", content: "Choose a new password for your PMPS Freelance account." },
      { property: "og:title", content: "Set a new password — PMPS Freelance" },
      { property: "og:description", content: "Securely update your PMPS Freelance sign-in password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [validRecovery, setValidRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const recoveryInHash = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    if (recoveryInHash) setValidRecovery(true);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setValidRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error("The passwords don’t match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error("The password could not be updated. Request a new reset email and try again.");
    else {
      toast.success("Your password has been updated.");
      await navigate({ to: "/" });
    }
    setSaving(false);
  }

  return (
    <main className="pmps-shell min-h-screen bg-background text-foreground">
      <header className="pmps-topbar">
        <a href="/" className="pmps-wordmark" aria-label="PMPS Freelance home"><span className="pmps-monogram">P</span><span>PMPS <i>FREELANCE</i></span></a>
      </header>
      <section className="pmps-recovery-page">
        <div className="pmps-kicker pmps-small-kicker">ACCOUNT SECURITY</div>
        <h1>Choose a new <em>password.</em></h1>
        {validRecovery ? (
          <form className="pmps-auth-form" onSubmit={(event) => void updatePassword(event)}>
            <label className="pmps-field"><span>New password</span><Input type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label className="pmps-field"><span>Confirm new password</span><Input type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            <Button className="pmps-primary-action w-full" disabled={saving}>{saving ? "Saving…" : "Save new password ↗"}</Button>
          </form>
        ) : (
          <div className="pmps-empty-state pmps-recovery-message">
            <h2>This reset link can’t be used.</h2>
            <p>Request a fresh password reset email from the sign-in screen, then open its latest link.</p>
            <Button className="pmps-primary-action" onClick={() => { window.location.href = "/"; }}>Return to sign in</Button>
          </div>
        )}
      </section>
    </main>
  );
}