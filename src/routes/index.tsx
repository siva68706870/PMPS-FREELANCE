import { createFileRoute } from "@tanstack/react-router";
import { BriefcaseBusiness, ChartNoAxesCombined, MessageCircleMore, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import marketplaceCover from "@/assets/pmps-freelance-cover.jpg";
import type { Tables, TablesInsert, Enums } from "@/integrations/supabase/types";
import { getOwnerDirectory, removeMarketplaceAccount } from "@/lib/owner.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PMPS Freelance — Find the right work, directly" },
      { name: "description", content: "A straightforward freelance marketplace. Clients post real work, freelancers apply in one click, and people work directly together." },
      { property: "og:title", content: "PMPS Freelance" },
      { property: "og:description", content: "A straightforward freelance marketplace for real jobs and real people." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PMPSFreelance,
});

type Role = Enums<"pmps_role">;
type Profile = Tables<"profiles">;
type Job = Tables<"jobs">;
type Application = Tables<"applications">;
type Message = Tables<"messages">;
type Report = Tables<"reports">;
type AppView = "jobs" | "applications" | "messages" | "profile" | "admin";
type OwnerMember = {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
  headline: string | null;
  location: string | null;
  skills: string[];
  account_state: string;
  created_at: string;
};

const roleLabel: Record<Role, string> = { client: "Client", freelancer: "Freelancer", owner: "Owner" };
const currency = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const initialJobForm = { title: "", category: "Design & Creative", description: "", budget_min: "", budget_max: "" };

function displayName(profile: Profile | null | undefined) {
  return profile?.display_name?.trim() || "Member";
}

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "PM";
}

function profileCompletion(profile: Profile | null) {
  if (!profile) return 0;
  const checks = [profile.headline, profile.bio, profile.location, profile.skills.length > 0, profile.avatar_url];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function PMPSFreelance() {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [ownerDirectory, setOwnerDirectory] = useState<OwnerMember[]>([]);
  const [view, setView] = useState<AppView>("jobs");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authRole, setAuthRole] = useState<Role>("freelancer");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPostJob, setShowPostJob] = useState(false);
  const [jobForm, setJobForm] = useState(initialJobForm);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ display_name: "", headline: "", bio: "", location: "", skills: "", company_name: "", portfolio_url: "", website_url: "", hourly_rate: "" });
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState("");
  const [reportCategory, setReportCategory] = useState("Account conduct");
  const [reportDetails, setReportDetails] = useState("");

  const owner = role === "owner";
  const applicationsByJob = useMemo(() => {
    const map = new Map<string, Application[]>();
    for (const application of applications) map.set(application.job_id, [...(map.get(application.job_id) ?? []), application]);
    return map;
  }, [applications]);
  const profileById = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles]);
  const jobById = useMemo(() => new Map(jobs.map((item) => [item.id, item])), [jobs]);
  const categories = useMemo(() => [...new Set(jobs.map((job) => job.category))].sort(), [jobs]);
  const myApplications = useMemo(() => applications.filter((item) => item.freelancer_id === userId), [applications, userId]);
  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const searchMatch = `${job.title} ${job.description} ${job.category}`.toLowerCase().includes(search.trim().toLowerCase());
    return searchMatch && (category === "all" || job.category === category);
  }), [jobs, search, category]);
  const conversations = useMemo(() => {
    const latestByPeerAndJob = new Map<string, Message>();
    for (const message of messages) {
      const peer = message.sender_id === userId ? message.recipient_id : message.sender_id;
      const key = `${peer}:${message.job_id ?? "direct"}`;
      const current = latestByPeerAndJob.get(key);
      if (!current || current.created_at < message.created_at) latestByPeerAndJob.set(key, message);
    }
    return [...latestByPeerAndJob.entries()].map(([key, latest]) => {
      const peerId = key.split(":")[0] ?? "";
      const job = latest.job_id ? jobById.get(latest.job_id) : undefined;
      return { key, latest, jobTitle: job?.title ?? "General message", jobId: latest.job_id, peer: profileById.get(peerId) };
    }).filter((item): item is typeof item & { peer: Profile } => Boolean(item.peer))
      .sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
  }, [messages, userId, jobById, profileById]);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) setUserId(data.user?.id ?? null);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      alive = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setRole(null);
      setProfile(null);
      setJobs([]);
      setApplications([]);
      setProfiles([]);
      setMessages([]);
      setReports([]);
      setOwnerDirectory([]);
      return;
    }
    void loadMarketplace(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId || role !== "owner" || view !== "admin") return;
    void loadOwnerDirectory();
  }, [userId, role, view]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`pmps-user-${userId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => { void refreshMessages(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => { void refreshReports(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId]);

  async function loadMarketplace(activeUserId: string) {
    setLoading(true);
    try {
      const [profileResponse, roleResponse, jobResponse, applicationResponse, messageResponse, reportResponse] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", activeUserId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", activeUserId).maybeSingle(),
        supabase.from("jobs").select("*").order("created_at", { ascending: false }),
        supabase.from("applications").select("*").order("created_at", { ascending: false }),
        supabase.from("messages").select("*").order("created_at", { ascending: true }),
        supabase.from("reports").select("*").order("created_at", { ascending: false }),
      ]);
      if (profileResponse.error || roleResponse.error || jobResponse.error || applicationResponse.error || messageResponse.error) {
        toast.error("Could not load the marketplace. Please refresh and try again.");
        return;
      }
      const loadedProfile = profileResponse.data;
      const loadedRole = roleResponse.data?.role ?? null;
      setProfile(loadedProfile);
      setRole(loadedRole);
      setJobs((jobResponse.data ?? []).filter((job) => job.status === "open" || job.client_id === activeUserId || loadedRole === "owner"));
      setApplications(applicationResponse.data ?? []);
      setMessages(messageResponse.data ?? []);
      setReports(reportResponse.data ?? []);
      setProfileForm({
        display_name: loadedProfile?.display_name ?? "",
        headline: loadedProfile?.headline ?? "",
        bio: loadedProfile?.bio ?? "",
        location: loadedProfile?.location ?? "",
        skills: loadedProfile?.skills.join(", ") ?? "",
        company_name: loadedProfile?.company_name ?? "",
        portfolio_url: loadedProfile?.portfolio_url ?? "",
        website_url: loadedProfile?.website_url ?? "",
        hourly_rate: loadedProfile?.hourly_rate?.toString() ?? "",
      });
      const involvedUserIds = new Set<string>([activeUserId]);
      for (const job of jobResponse.data ?? []) involvedUserIds.add(job.client_id);
      for (const application of applicationResponse.data ?? []) involvedUserIds.add(application.freelancer_id);
      for (const message of messageResponse.data ?? []) {
        involvedUserIds.add(message.sender_id);
        involvedUserIds.add(message.recipient_id);
      }
      for (const report of reportResponse.data ?? []) {
        if (report.reporter_id) involvedUserIds.add(report.reporter_id);
        if (report.target_id) involvedUserIds.add(report.target_id);
      }
      if (loadedRole === "owner") {
        const { data: directory } = await supabase.from("profiles").select("id");
        for (const item of directory ?? []) involvedUserIds.add(item.id);
      }
      const idList = [...involvedUserIds];
      if (idList.length > 0) {
        const { data: relatedProfiles } = await supabase.from("profiles").select("*").in("id", idList);
        setProfiles(relatedProfiles ?? []);
      }
      if (loadedRole === "owner") {
        const { data: roleRows } = await supabase.from("user_roles").select("role");
        const counts = new Map<string, number>();
        for (const row of roleRows ?? []) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
        setOwnerRoleCounts(counts);
      }
    } finally {
      setLoading(false);
    }
  }

  const [ownerRoleCounts, setOwnerRoleCounts] = useState<Map<string, number>>(new Map());

  async function loadOwnerDirectory() {
    try {
      const directory = await getOwnerDirectory();
      setOwnerDirectory(directory as OwnerMember[]);
    } catch {
      toast.error("Owner account list could not be loaded.");
    }
  }

  async function refreshMessages() {
    const { data } = await supabase.from("messages").select("*").order("created_at", { ascending: true });
    if (data) setMessages(data);
  }

  async function refreshReports() {
    const { data } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
    if (data) setReports(data);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: authName.trim(), role: authRole },
          },
        });
        if (error) throw error;
        if (data.session) {
          setShowAuth(false);
          toast.success("Your account is ready. Finish your profile to get started.");
        } else {
          setShowAuth(false);
          toast.success("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
        if (error) throw error;
        setShowAuth(false);
        toast.success("Welcome back.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) throw result.error;
      if (result.redirected) return;
      setShowAuth(false);
      toast.success("Signed in with Google.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign-in is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setView("jobs");
    setShowAuth(false);
    toast.success("You are signed out.");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !userId) return;
    setBusy(true);
    const updates = {
      display_name: profileForm.display_name.trim(),
      headline: profileForm.headline.trim() || null,
      bio: profileForm.bio.trim() || null,
      location: profileForm.location.trim() || null,
      skills: profileForm.skills.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20),
      company_name: profileForm.company_name.trim() || null,
      portfolio_url: profileForm.portfolio_url.trim() || null,
      website_url: profileForm.website_url.trim() || null,
      hourly_rate: profileForm.hourly_rate ? Number(profileForm.hourly_rate) : null,
    };
    const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
    if (error) toast.error("Could not save your profile.");
    else {
      setProfile({ ...profile, ...updates });
      setProfiles((items) => items.map((item) => item.id === userId ? { ...item, ...updates } : item));
      setEditingProfile(false);
      toast.success("Profile saved.");
    }
    setBusy(false);
  }

  async function chooseRole(nextRole: "client" | "freelancer") {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_initial_role", { _role: nextRole });
    if (error || !data) toast.error("Your account type could not be selected.");
    else {
      setRole(nextRole);
      toast.success(`You're set up as a ${roleLabel[nextRole].toLowerCase()}.`);
      if (userId) await loadMarketplace(userId);
    }
    setBusy(false);
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    const payload: TablesInsert<"jobs"> = {
      client_id: userId,
      title: jobForm.title.trim(),
      category: jobForm.category,
      description: jobForm.description.trim(),
      budget_min: jobForm.budget_min ? Number(jobForm.budget_min) : null,
      budget_max: jobForm.budget_max ? Number(jobForm.budget_max) : null,
    };
    const { data, error } = await supabase.from("jobs").insert(payload).select("*").single();
    if (error) toast.error(error.message.includes("policy") ? "Only client accounts can post jobs." : "Could not post this job.");
    else {
      setJobs((items) => [data, ...items]);
      setShowPostJob(false);
      setJobForm(initialJobForm);
      toast.success("Your job is live.");
    }
    setBusy(false);
  }

  async function applyToJob(jobId: string) {
    if (!userId) { setShowAuth(true); return; }
    if (role !== "freelancer") { toast.message("Freelancer accounts can apply to jobs."); return; }
    const { error } = await supabase.from("applications").insert({ job_id: jobId, freelancer_id: userId });
    if (error) toast.error(error.code === "23505" ? "You’ve already applied to this job." : "Could not send your application.");
    else {
      toast.success("Application sent. The client can now review your profile.");
      await loadMarketplace(userId);
    }
  }

  async function setApplicationStatus(application: Application, status: Application["status"]) {
    const { error } = await supabase.from("applications").update({ status }).eq("id", application.id);
    if (error) toast.error("Could not update this application.");
    else {
      setApplications((items) => items.map((item) => item.id === application.id ? { ...item, status } : item));
      toast.success(`Application marked ${status}.`);
    }
  }

  async function respondToSelection(application: Application, response: "accepted" | "declined") {
    const { error } = await supabase.from("applications").update({ freelancer_response: response }).eq("id", application.id);
    if (error) toast.error("Could not send your response.");
    else {
      setApplications((items) => items.map((item) => item.id === application.id ? { ...item, freelancer_response: response } : item));
      toast.success(response === "accepted" ? "You accepted the job." : "You passed on the job.");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !activeConversation || !messageText.trim()) return;
    const peer = conversations.find((conversation) => conversation.key === activeConversation);
    if (!peer) return;
    const { data, error } = await supabase.from("messages").insert({
      sender_id: userId,
      recipient_id: peer.peer.id,
      job_id: peer.jobId,
      body: messageText.trim(),
    }).select("*").single();
    if (error) toast.error("Could not send this message. A job application may be needed first.");
    else {
      setMessages((items) => [...items, data]);
      setMessageText("");
    }
  }

  async function startConversation(target: Profile, jobId: string | null = null) {
    if (!userId) { setShowAuth(true); return; }
    const found = conversations.find((item) => item.peer.id === target.id && item.jobId === jobId);
    if (found) setActiveConversation(found.key);
    else {
      const { data: existing } = await supabase.from("messages").select("*").or(`and(sender_id.eq.${userId},recipient_id.eq.${target.id}),and(sender_id.eq.${target.id},recipient_id.eq.${userId})`).order("created_at", { ascending: true });
      if (existing && existing.length > 0) {
        setMessages((items) => [...items, ...existing.filter((message) => !items.some((item) => item.id === message.id))]);
        setActiveConversation(`${target.id}:${jobId ?? "direct"}`);
      } else {
        toast.message("A conversation opens after a freelancer applies to a job.");
        return;
      }
    }
    setView("messages");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !reportTarget) return;
    const { error } = await supabase.from("reports").insert({ reporter_id: userId, target_id: reportTarget, category: reportCategory, details: reportDetails.trim() });
    if (error) toast.error("Could not send this report.");
    else {
      setShowReport(false);
      setReportDetails("");
      setReportTarget("");
      toast.success("Report sent to the PMPS owner for review.");
      await refreshReports();
    }
  }

  async function updateReport(report: Report, status: string) {
    const { error } = await supabase.from("reports").update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null }).eq("id", report.id);
    if (error) toast.error("Could not update this report.");
    else {
      setReports((items) => items.map((item) => item.id === report.id ? { ...item, status, resolved_at: status === "resolved" ? new Date().toISOString() : null } : item));
      toast.success("Report updated.");
    }
  }

  async function removeAccount(userIdToRemove: string) {
    if (!window.confirm("Remove this account from PMPS Freelance? This will permanently delete their account and marketplace records.")) return;
    try {
      await removeMarketplaceAccount({ data: { userId: userIdToRemove } });
      toast.success("Member account removed.");
      await loadOwnerDirectory();
      if (userId) await loadMarketplace(userId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This account could not be removed.");
    }
  }

  const openSignIn = () => { setAuthMode("signin"); setShowAuth(true); };
  const nav = [
    { id: "jobs" as const, label: "Find work", icon: BriefcaseBusiness },
    ...(role === "freelancer" ? [{ id: "applications" as const, label: "My applications", icon: ChartNoAxesCombined }] : []),
    ...(role === "client" ? [{ id: "applications" as const, label: "Applicants", icon: ChartNoAxesCombined }] : []),
    ...(role === "owner" ? [{ id: "applications" as const, label: "Applications", icon: ChartNoAxesCombined }] : []),
    ...(userId ? [{ id: "messages" as const, label: "Messages", icon: MessageCircleMore }] : []),
    ...(owner ? [{ id: "admin" as const, label: "Owner desk", icon: ShieldCheck }] : []),
  ];

  return (
    <main className="pmps-shell min-h-screen bg-background text-foreground">
      <header className="pmps-topbar">
        <a href="#top" className="pmps-wordmark" aria-label="PMPS Freelance home">
          <span className="pmps-monogram">P</span><span>PMPS <i>FREELANCE</i></span>
        </a>
        <div className="hidden items-center gap-2 md:flex">
          <span className="pmps-trust-mark"><span className="pmps-live-dot" />Real people. Real work.</span>
          {userId ? (
            <div className="pmps-account-chip"><span className="pmps-avatar pmps-avatar-small">{initials(displayName(profile))}</span><span>{displayName(profile)}</span><Badge variant="outline">{role ? roleLabel[role] : "Member"}</Badge><Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button></div>
          ) : <Button variant="outline" size="sm" onClick={openSignIn}>Sign in</Button>}
        </div>
        <div className="flex items-center gap-2 md:hidden">
          {userId ? <Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button> : <Button variant="outline" size="sm" onClick={openSignIn}>Sign in</Button>}
          {role === "client" || owner ? <Button size="sm" onClick={() => userId ? setShowPostJob(true) : (setAuthMode("signup"), setShowAuth(true))}>Post a job</Button> : <Button size="sm" onClick={() => userId ? document.getElementById("marketplace")?.scrollIntoView({ behavior: "smooth" }) : (setAuthMode("signup"), setShowAuth(true))}>{userId ? "Find work" : "Join PMPS"}</Button>}
        </div>
      </header>

      <section id="top" className="pmps-intro">
        <div className="pmps-intro-copy">
          <div className="pmps-kicker"><span className="pmps-kicker-mark" />THE WORK, WITHOUT THE RUNAROUND</div>
          <h1>Good work starts<br />with <em>one click.</em></h1>
          <p>Real jobs from real clients. Apply directly, talk to the people behind the work, and get started without gigs or proposals.</p>
          <div className="pmps-intro-actions">
            <Button className="pmps-primary-action" onClick={() => document.getElementById("marketplace")?.scrollIntoView({ behavior: "smooth" })}>Explore open jobs <span aria-hidden="true">↗</span></Button>
            {userId && role === "client" ? <Button variant="outline" onClick={() => setShowPostJob(true)}>Post a job <span aria-hidden="true">+</span></Button> : !userId ? <Button variant="outline" onClick={() => { setAuthMode("signup"); setShowAuth(true); }}>Join PMPS <span aria-hidden="true">↗</span></Button> : null}
          </div>
          <div className="pmps-proof-line"><span><strong>01</strong> One-click applications</span><span><strong>02</strong> Direct conversations</span><span><strong>03</strong> No fake listings</span></div>
        </div>
        <figure className="pmps-intro-photo"><img src={marketplaceCover} alt="A designer and client discussing a project brief" width={1600} height={1008} /><figcaption><span className="pmps-photo-caption-dot" />Good projects begin with a real conversation.</figcaption></figure>
      </section>

      <section className="pmps-stats" aria-label="Marketplace principles">
        <div><strong>01</strong><span>Real people</span><p>No made-up profiles or listings.</p></div>
        <div><strong>02</strong><span>One-click apply</span><p>Skip gigs. Skip proposals.</p></div>
        <div><strong>03</strong><span>80 / 20</span><p>Freelancers / PMPS owner share.</p></div>
        <div><strong>04</strong><span>Built on trust</span><p>Send a report directly to the owner.</p></div>
      </section>

      <section id="marketplace" className="pmps-workspace">
        <aside className="pmps-sidebar">
          <div className="pmps-sidebar-label">WORKSPACE</div>
          <nav aria-label="Marketplace views" className="pmps-nav-list">
            {nav.map(({ id, label, icon: Icon }) => <Button key={id} variant="ghost" onClick={() => setView(id)} className={`pmps-nav-item ${view === id ? "is-active" : ""}`}><Icon aria-hidden="true" /><span>{label}</span>{id === "messages" && conversations.length > 0 ? <Badge variant="secondary">{conversations.length}</Badge> : null}</Button>)}
            <Button variant="ghost" onClick={() => { setView("profile"); setEditingProfile(true); }} className={`pmps-nav-item ${view === "profile" ? "is-active" : ""}`}><span className="pmps-avatar pmps-avatar-small">{initials(displayName(profile))}</span><span>My profile</span></Button>
          </nav>
          {userId ? <div className="pmps-sidebar-user"><div className="pmps-sidebar-avatar pmps-avatar">{initials(displayName(profile))}</div><div className="min-w-0"><strong>{displayName(profile)}</strong><span>{role ? roleLabel[role] : "Pick an account type"}</span></div><Button variant="ghost" size="icon" className="pmps-icon-button" aria-label="Report a user" title="Report a user" onClick={() => { setReportTarget(""); setShowReport(true); }}>⋯</Button></div> : <div className="pmps-sidebar-signin"><p>Join the work community.</p><Button size="sm" onClick={() => { setAuthMode("signup"); setShowAuth(true); }}>Create account</Button></div>}
          <div className="pmps-sidebar-foot"><span className="pmps-live-dot" />A marketplace for real work</div>
        </aside>

        <div className="pmps-main-panel">
          {view === "jobs" && <>
            <div className="pmps-section-topline"><div><div className="pmps-kicker pmps-small-kicker">THE OPEN MARKET</div><h2>Find your next <em>project.</em></h2><p>Thoughtful work from clients looking for the right person.</p></div>{role === "client" || owner ? <Button className="pmps-primary-action" onClick={() => setShowPostJob(true)}>Post a job <span aria-hidden="true">+</span></Button> : null}</div>
            <div className="pmps-filter-row"><label className="pmps-search"><span aria-hidden="true">⌕</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search jobs, skills, categories" aria-label="Search jobs" /></label><Select value={category} onValueChange={(next) => setCategory(next ?? "all")}><SelectTrigger className="pmps-category-select"><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><span className="pmps-result-count">{filteredJobs.length} open {filteredJobs.length === 1 ? "role" : "roles"}</span></div>
            {!userId ? <div className="pmps-soft-note">Sign in to apply, message clients, or save your profile.</div> : null}
            {loading ? <div className="pmps-empty-state">Loading open jobs…</div> : filteredJobs.length === 0 ? <div className="pmps-empty-state"><div className="pmps-empty-icon"><BriefcaseBusiness /></div><h3>No jobs here just yet.</h3><p>Try another search, or check back when a new role is posted.</p>{role === "client" || owner ? <Button onClick={() => setShowPostJob(true)}>Post the first job <span>+</span></Button> : null}</div> : <div className="pmps-job-list">{filteredJobs.map((job) => {
              const myApplication = myApplications.find((application) => application.job_id === job.id);
              const submitted = Boolean(myApplication);
              const poster = profileById.get(job.client_id);
              const applicationCount = applicationsByJob.get(job.id)?.length ?? 0;
              return <article className="pmps-job-row" key={job.id}>
                <div className="pmps-job-main"><div className="pmps-job-title-row"><Badge variant="outline" className="pmps-category-badge">{job.category}</Badge><span className="pmps-job-date">{relativeDate(job.created_at)}</span></div><h3>{job.title}</h3><p>{job.description}</p><div className="pmps-job-metadata"><span className="pmps-client-avatar">{initials(displayName(poster))}</span><strong>{displayName(poster)}</strong>{poster?.company_name ? <span>{poster.company_name}</span> : null}<span className="pmps-metadata-separator">·</span><span>{poster?.location ?? "Remote"}</span></div></div>
                <div className="pmps-job-side"><div className="pmps-budget-label">PROJECT BUDGET</div><strong className="pmps-budget">{job.budget_min == null && job.budget_max == null ? "Discuss" : `${job.budget_min != null ? `₹${currency.format(job.budget_min)}` : ""}${job.budget_min != null && job.budget_max != null ? " – " : ""}${job.budget_max != null ? `₹${currency.format(job.budget_max)}` : ""}`}</strong><span className="pmps-applicant-count">{applicationCount} applicants</span>{role === "client" && job.client_id === userId ? <Button variant="outline" onClick={() => setView("applications")}>View applicants</Button> : role === "freelancer" ? <Button variant={submitted ? "secondary" : "default"} className={submitted ? "pmps-applied-button" : "pmps-primary-action"} disabled={submitted} onClick={() => void applyToJob(job.id)}>{submitted ? "Applied ✓" : "Apply in one click ↗"}</Button> : !userId ? <Button variant="outline" onClick={openSignIn}>Sign in to apply</Button> : null}</div>
              </article>;
            })}</div>}
          </>}

          {view === "applications" && <ApplicationWorkspace role={role} userId={userId} jobs={jobs} applications={applications} profiles={profileById} onStatus={setApplicationStatus} onRespond={respondToSelection} onMessage={startConversation} />}
          {view === "messages" && <section className="pmps-content-section"><div className="pmps-kicker pmps-small-kicker">DIRECT CONVERSATIONS</div><h2>Your <em>messages.</em></h2><p className="pmps-section-description">Talk directly with the people behind the work.</p><div className="pmps-message-layout">{conversations.length === 0 ? <div className="pmps-empty-state pmps-message-empty"><div className="pmps-empty-icon"><MessageCircleMore /></div><h3>No conversations yet.</h3><p>Messages become available after a job application is submitted.</p></div> : <><div className="pmps-conversation-list">{conversations.map((conversation) => <button type="button" className={`pmps-conversation-item ${activeConversation === conversation.key ? "is-selected" : ""}`} key={conversation.key} onClick={() => setActiveConversation(conversation.key)}><span className="pmps-avatar">{initials(displayName(conversation.peer))}</span><span className="pmps-conversation-details"><strong>{displayName(conversation.peer)}</strong><span>{conversation.jobTitle}</span><small>{conversation.latest.body}</small></span></button>)}</div><div className="pmps-chat-window">{activeConversation ? (() => {
                const conversation = conversations.find((item) => item.key === activeConversation);
                if (!conversation) return <div className="pmps-chat-placeholder">Select a conversation to continue.</div>;
                const thread = messages.filter((item) => item.job_id === conversation.jobId && ((item.sender_id === userId && item.recipient_id === conversation.peer.id) || (item.sender_id === conversation.peer.id && item.recipient_id === userId)));
                return <><div className="pmps-chat-header"><span className="pmps-avatar">{initials(displayName(conversation.peer))}</span><span><strong>{displayName(conversation.peer)}</strong><small>{conversation.jobTitle}</small></span><Button variant="outline" size="sm" onClick={() => { setReportTarget(conversation.peer.id); setShowReport(true); }}>Report</Button></div><div className="pmps-chat-thread">{thread.map((item) => <div className={`pmps-chat-message ${item.sender_id === userId ? "is-mine" : ""}`} key={item.id}><p>{item.body}</p><time>{new Date(item.created_at).toLocaleString()}</time></div>)}</div><form className="pmps-chat-compose" onSubmit={(event) => void sendMessage(event)}><Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Write a message…" maxLength={4000} aria-label="Message" required /><Button type="submit" disabled={!messageText.trim()}>Send ↗</Button></form></>;
              })() : <div className="pmps-chat-placeholder">Choose a conversation to open the message thread.</div>}</div></>}</div></section>}

          {view === "profile" && <section className="pmps-content-section"><div className="pmps-kicker pmps-small-kicker">YOUR PUBLIC PROFILE</div><h2>Show your <em>good work.</em></h2><div className="pmps-profile-summary"><span className="pmps-profile-large-avatar pmps-avatar">{initials(displayName(profile))}</span><span><strong>{displayName(profile)}</strong><span>{role ? roleLabel[role] : "Account type needed"} · {profile?.location ?? "Add a location"}</span></span><span className="pmps-profile-progress">{profileCompletion(profile)}% complete</span></div>
            {!role ? <div className="pmps-role-choice"><h3>How will you use PMPS Freelance?</h3><p>Choose your account type. This can only be selected once.</p><div className="pmps-role-choice-buttons"><Button className="pmps-primary-action" disabled={busy} onClick={() => void chooseRole("freelancer")}>I’m a freelancer ↗</Button><Button variant="outline" disabled={busy} onClick={() => void chooseRole("client")}>I’m hiring ↗</Button></div></div> : null}
            {editingProfile ? <form className="pmps-form-grid" onSubmit={(event) => void saveProfile(event)}><Field label="Display name"><Input value={profileForm.display_name} onChange={(event) => setProfileForm({ ...profileForm, display_name: event.target.value })} required maxLength={120} /></Field><Field label="Headline"><Input value={profileForm.headline} onChange={(event) => setProfileForm({ ...profileForm, headline: event.target.value })} placeholder="e.g. Independent brand designer" maxLength={160} /></Field><Field label="Location"><Input value={profileForm.location} onChange={(event) => setProfileForm({ ...profileForm, location: event.target.value })} maxLength={120} /></Field><Field label={role === "client" ? "Company or organization" : "Hourly rate (₹), optional"}>{role === "client" ? <Input value={profileForm.company_name} onChange={(event) => setProfileForm({ ...profileForm, company_name: event.target.value })} maxLength={160} /> : <Input type="number" min="0" value={profileForm.hourly_rate} onChange={(event) => setProfileForm({ ...profileForm, hourly_rate: event.target.value })} />}</Field><Field label="About you"><Textarea value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} maxLength={3000} rows={4} /></Field><Field label="Skills, separated by commas"><Input value={profileForm.skills} onChange={(event) => setProfileForm({ ...profileForm, skills: event.target.value })} placeholder="Design, writing, research" /></Field><Field label="Portfolio URL"><Input type="url" value={profileForm.portfolio_url} onChange={(event) => setProfileForm({ ...profileForm, portfolio_url: event.target.value })} placeholder="https://" /></Field><Field label="Website URL"><Input type="url" value={profileForm.website_url} onChange={(event) => setProfileForm({ ...profileForm, website_url: event.target.value })} placeholder="https://" /></Field><Button type="submit" className="pmps-primary-action" disabled={busy}>Save profile</Button>{!role ? <p className="pmps-form-hint">Choose your account type above to unlock job actions.</p> : null}</form> : <div className="pmps-profile-view"><div><div className="pmps-detail-label">ABOUT</div><p>{profile?.bio || "Add a short introduction so the right people can get to know you."}</p></div><div><div className="pmps-detail-label">SKILLS</div><div className="pmps-skills">{profile?.skills.length ? profile.skills.map((skill) => <Badge key={skill} variant="outline">{skill}</Badge>) : <span>Add the skills you bring to a project.</span>}</div></div>{profile?.headline ? <div><div className="pmps-detail-label">HEADLINE</div><p>{profile.headline}</p></div> : null}<Button variant="outline" onClick={() => setEditingProfile(true)}>Edit profile</Button></div>}</section>}

          {view === "admin" && owner ? <section className="pmps-content-section"><div className="pmps-kicker pmps-small-kicker">OWNER ONLY</div><h2>Trust starts <em>here.</em></h2><p className="pmps-section-description">Review reports, manage members, and keep the marketplace genuine.</p><Tabs defaultValue="reports" className="pmps-admin-tabs"><TabsList><TabsTrigger value="reports">Reports <Badge variant="secondary">{reports.filter((report) => report.status !== "resolved").length}</Badge></TabsTrigger><TabsTrigger value="members">Members <Badge variant="secondary">{ownerDirectory.length}</Badge></TabsTrigger></TabsList><TabsContent value="reports"><div className="pmps-admin-list">{reports.length === 0 ? <div className="pmps-empty-state"><h3>No reports to review.</h3><p>Reports from clients and freelancers will appear here.</p></div> : reports.map((report) => <ReportRow key={report.id} report={report} profiles={profileById} onStatus={updateReport} />)}</div></TabsContent><TabsContent value="members"><div className="pmps-member-stats"><span>Freelancers <strong>{ownerRoleCounts.get("freelancer") ?? 0}</strong></span><span>Clients <strong>{ownerRoleCounts.get("client") ?? 0}</strong></span></div><div className="pmps-admin-list">{ownerDirectory.map((member) => <div className="pmps-member-row" key={String(member.id)}><span className="pmps-avatar">{initials(String(member.display_name ?? "Member"))}</span><span className="pmps-member-details"><strong>{String(member.display_name ?? "Member")}</strong><span>{String(member.email ?? "")} · {String(member.role ?? "freelancer")}</span></span><Badge variant={member.account_state === "active" ? "outline" : "destructive"}>{String(member.account_state ?? "active")}</Badge><Button variant="destructive" size="sm" disabled={String(member.id) === userId} onClick={() => void removeAccount(String(member.id))}>Remove</Button></div>)}</div></TabsContent></Tabs></section> : null}
        </div>
      </section>

      <footer className="pmps-footer"><a href="#top" className="pmps-wordmark pmps-footer-wordmark"><span className="pmps-monogram">P</span><span>PMPS <i>FREELANCE</i></span></a><p>Good work. Fair share. Real people.</p><span>Built for the way people actually work.</span></footer>

      <Dialog open={showAuth} onOpenChange={setShowAuth}><DialogContent className="pmps-dialog"><DialogHeader><div className="pmps-kicker pmps-small-kicker">A BETTER WAY TO WORK</div><DialogTitle>{authMode === "signup" ? "Join PMPS Freelance." : "Welcome back."}</DialogTitle><DialogDescription>{authMode === "signup" ? "Create a real account to apply for work or hire a freelancer." : "Sign in to find work, meet clients, and manage your projects."}</DialogDescription></DialogHeader><form className="pmps-auth-form" onSubmit={(event) => void handleAuthSubmit(event)}>{authMode === "signup" ? <><Field label="Your name"><Input value={authName} onChange={(event) => setAuthName(event.target.value)} maxLength={120} required autoComplete="name" /></Field><Field label="I’m here as"><Select value={authRole} onValueChange={(next) => { if (next === "client" || next === "freelancer") setAuthRole(next); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="freelancer">Freelancer</SelectItem><SelectItem value="client">Client</SelectItem></SelectContent></Select></Field></> : null}<Field label="Email"><Input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required /></Field><Field label="Password"><Input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} required /></Field><Button type="submit" className="pmps-primary-action w-full" disabled={busy}>{busy ? "Please wait…" : authMode === "signup" ? "Create account ↗" : "Sign in ↗"}</Button></form><div className="pmps-auth-divider"><span />OR<span /></div><Button variant="outline" className="w-full" disabled={busy} onClick={() => void handleGoogleSignIn()}><GoogleMark />Continue with Google</Button><p className="pmps-auth-switch">{authMode === "signup" ? "Already have an account?" : "New to PMPS Freelance?"}<button type="button" onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p></DialogContent></Dialog>

      <Dialog open={showPostJob} onOpenChange={setShowPostJob}><DialogContent className="pmps-dialog pmps-wide-dialog"><DialogHeader><div className="pmps-kicker pmps-small-kicker">NEW PROJECT</div><DialogTitle>Tell people what you need.</DialogTitle><DialogDescription>Clear details help the right freelancer decide quickly.</DialogDescription></DialogHeader><form className="pmps-auth-form" onSubmit={(event) => void createJob(event)}><Field label="Job title"><Input value={jobForm.title} onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })} placeholder="e.g. Refresh our brand identity" maxLength={160} minLength={3} required /></Field><Field label="Category"><Select value={jobForm.category} onValueChange={(next) => { if (next) setJobForm({ ...jobForm, category: next }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Design & Creative", "Writing & Content", "Development & Tech", "Marketing", "Business & Consulting", "Other"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Field label="Project description"><Textarea value={jobForm.description} onChange={(event) => setJobForm({ ...jobForm, description: event.target.value })} placeholder="What needs to be done? Include goals, context, and what a good result looks like." maxLength={5000} minLength={20} required rows={5} /></Field><div className="pmps-budget-fields"><Field label="Minimum budget (₹), optional"><Input type="number" min="0" value={jobForm.budget_min} onChange={(event) => setJobForm({ ...jobForm, budget_min: event.target.value })} /></Field><Field label="Maximum budget (₹), optional"><Input type="number" min="0" value={jobForm.budget_max} onChange={(event) => setJobForm({ ...jobForm, budget_max: event.target.value })} /></Field></div><Button type="submit" className="pmps-primary-action w-full" disabled={busy}>{busy ? "Posting…" : "Post open job ↗"}</Button></form></DialogContent></Dialog>

      <Dialog open={showReport} onOpenChange={setShowReport}><DialogContent className="pmps-dialog"><DialogHeader><div className="pmps-kicker pmps-small-kicker">YOUR REPORT GOES TO THE OWNER</div><DialogTitle>Tell us what happened.</DialogTitle><DialogDescription>Reports are private and sent directly to the PMPS owner.</DialogDescription></DialogHeader><form className="pmps-auth-form" onSubmit={(event) => void submitReport(event)}><Field label="Account to report"><Select value={reportTarget} onValueChange={(next) => setReportTarget(next ?? "")}><SelectTrigger><SelectValue placeholder="Choose a member" /></SelectTrigger><SelectContent>{profiles.filter((item) => item.id !== userId).map((item) => <SelectItem value={item.id} key={item.id}>{displayName(item)}{item.company_name ? ` · ${item.company_name}` : ""}</SelectItem>)}</SelectContent></Select></Field><Field label="What is this about?"><Select value={reportCategory} onValueChange={(next) => setReportCategory(next ?? "Account conduct")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Account conduct", "Job listing concern", "Communication issue", "Payment concern", "Other"].map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Field label="Details"><Textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} minLength={10} maxLength={3000} rows={5} placeholder="Share what happened so the owner can review it." required /></Field><Button type="submit" className="pmps-primary-action w-full" disabled={!reportTarget || busy}>Send private report ↗</Button></form></DialogContent></Dialog>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="pmps-field"><Label>{label}</Label>{children}</label>;
}

function ApplicationWorkspace({ role, userId, jobs, applications, profiles, onStatus, onRespond, onMessage }: {
  role: Role | null;
  userId: string | null;
  jobs: Job[];
  applications: Application[];
  profiles: Map<string, Profile>;
  onStatus: (application: Application, status: Application["status"]) => Promise<void>;
  onRespond: (application: Application, response: "accepted" | "declined") => Promise<void>;
  onMessage: (profile: Profile, jobId: string) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const visibleApplications = applications.filter((application) => {
    const job = jobs.find((item) => item.id === application.job_id);
    if (role === "freelancer" && application.freelancer_id !== userId) return false;
    if (role === "client" && job?.client_id !== userId) return false;
    return statusFilter === "all" || application.status === statusFilter;
  });
  return <section className="pmps-content-section"><div className="pmps-kicker pmps-small-kicker">APPLICATION DESK</div><h2>{role === "freelancer" ? <>Your next <em>step.</em></> : <>The right <em>people.</em></>}</h2><p className="pmps-section-description">{role === "freelancer" ? "Track your applications and respond when a client selects you." : "Review profiles, shortlist promising applicants, and select the right fit."}</p><div className="pmps-filter-row pmps-app-filter"><Select value={statusFilter} onValueChange={(next) => setStatusFilter(next ?? "all")}><SelectTrigger className="pmps-status-select"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{["pending", "shortlisted", "selected", "rejected"].map((item) => <SelectItem key={item} value={item}>{statusTitle(item)}</SelectItem>)}</SelectContent></Select><span className="pmps-result-count">{visibleApplications.length} applications</span></div>{visibleApplications.length === 0 ? <div className="pmps-empty-state"><div className="pmps-empty-icon"><ChartNoAxesCombined /></div><h3>No applications to show.</h3><p>{role === "freelancer" ? "Apply to an open job and track it here." : "When a freelancer applies to your job, their profile will appear here."}</p></div> : <div className="pmps-application-list">{visibleApplications.map((application) => {
    const job = jobs.find((item) => item.id === application.job_id);
    const freelancer = profiles.get(application.freelancer_id);
    if (!job) return null;
    return <article className="pmps-application-row" key={application.id}><div className="pmps-applicant-avatar pmps-avatar">{initials(displayName(freelancer))}</div><div className="pmps-application-details"><div className="pmps-job-title-row"><Badge variant="outline" className="pmps-category-badge">{job.category}</Badge><StatusBadge status={application.status} /></div><h3>{role === "freelancer" ? job.title : displayName(freelancer)}</h3><p>{role === "freelancer" ? `Client: ${displayName(profiles.get(job.client_id))}` : freelancer?.headline ?? freelancer?.bio ?? "This freelancer is building their profile."}</p><div className="pmps-application-tags">{freelancer?.skills.map((skill) => <Badge key={skill} variant="secondary">{skill}</Badge>)}{role !== "freelancer" && freelancer?.location ? <span>{freelancer.location}</span> : null}</div></div><div className="pmps-application-actions">{role === "client" || role === "owner" ? <><Button size="sm" variant="outline" onClick={() => void onMessage(freelancer ?? { id: application.freelancer_id } as Profile, job.id)}>Message</Button><Select value={application.status} onValueChange={(next) => { if (next && ["pending", "shortlisted", "selected", "rejected"].includes(next)) void onStatus(application, next as Application["status"]); }}><SelectTrigger className="pmps-decision-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="shortlisted">Shortlist</SelectItem><SelectItem value="selected">Select</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent></Select></> : application.status === "selected" && application.freelancer_response === "pending" ? <><Button size="sm" className="pmps-primary-action" onClick={() => void onRespond(application, "accepted")}>Accept job ↗</Button><Button size="sm" variant="outline" onClick={() => void onRespond(application, "declined")}>Pass</Button></> : <Badge variant={application.freelancer_response === "accepted" ? "default" : "outline"}>{application.freelancer_response === "accepted" ? "Accepted" : application.freelancer_response === "declined" ? "Passed" : application.status}</Badge>}</div></article>;
  })}</div>}</section>;
}

function ReportRow({ report, profiles, onStatus }: { report: Report; profiles: Map<string, Profile>; onStatus: (report: Report, status: string) => Promise<void> }) {
  return <article className="pmps-report-row"><div className="pmps-report-heading"><Badge variant={report.status === "new" ? "destructive" : "outline"}>{statusTitle(report.status)}</Badge><span>{new Date(report.created_at).toLocaleString()}</span></div><strong>{report.category}</strong><p>{report.details}</p><div className="pmps-report-people"><span>From <strong>{displayName(profiles.get(report.reporter_id ?? ""))}</strong></span><span>About <strong>{displayName(profiles.get(report.target_id ?? ""))}</strong></span></div><div className="pmps-report-actions"><Button size="sm" variant="outline" onClick={() => void onStatus(report, "reviewing")}>Mark reviewing</Button><Button size="sm" onClick={() => void onStatus(report, "resolved")}>Resolve</Button></div></article>;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "selected" ? "default" : status === "rejected" ? "destructive" : "outline";
  return <Badge variant={variant}>{statusTitle(status)}</Badge>;
}

function statusTitle(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function relativeDate(date: string) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.75 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.11A6.61 6.61 0 0 1 5.49 12c0-.73.13-1.44.35-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.06 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84C6.71 7.29 9.14 5.36 12 5.36Z"/></svg>;
}
