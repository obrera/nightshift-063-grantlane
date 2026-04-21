import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import type {
  ActivityItem,
  ApplicantView,
  BalanceQueueItem,
  BudgetLine,
  CoordinatorView,
  DashboardData,
  DecisionQueueItem,
  FinalDecision,
  Milestone,
  RecommendationSpread,
  ReviewAssignment,
  ReviewerRecommendation,
  ReviewerView,
  RubricCriterion,
  SessionUser,
  SubmissionRecord,
} from "./types";

type SessionResponse = {
  user: SessionUser | null;
};

type AuthMode = "register" | "signin";

type DraftLineState = {
  amount: string;
  label: string;
};

type DraftMilestoneState = {
  dueDate: string;
  note: string;
  title: string;
};

type DraftFormState = {
  budgetLines: DraftLineState[];
  budgetTotal: string;
  id?: number;
  milestones: DraftMilestoneState[];
  organization: string;
  summary: string;
  tagsText: string;
  title: string;
};

type ReviewFormState = {
  conflictFlag: boolean;
  notes: string;
  recommendation: ReviewerRecommendation;
  scores: Record<string, number>;
};

type SeedAccount = {
  email: string;
  label: string;
  password: string;
  role: SessionUser["role"];
};

const seedAccounts: SeedAccount[] = [
  {
    email: "obrera@grantlane.local",
    label: "Ana Obrera",
    password: "nightshift063",
    role: "coordinator",
  },
  {
    email: "applicant@grantlane.local",
    label: "Mina Sol",
    password: "nightshift063",
    role: "applicant",
  },
  {
    email: "reviewer.one@grantlane.local",
    label: "Jon Park",
    password: "nightshift063",
    role: "reviewer",
  },
];

const blankDraft = (user: SessionUser | null): DraftFormState => ({
  budgetLines: [
    { amount: "", label: "Staff time" },
    { amount: "", label: "Public programming" },
  ],
  budgetTotal: "",
  milestones: [
    { dueDate: "", note: "", title: "" },
    { dueDate: "", note: "", title: "" },
  ],
  organization: user?.organization ?? "",
  summary: "",
  tagsText: "",
  title: "",
});

export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [draftForm, setDraftForm] = useState<DraftFormState>(blankDraft(null));
  const [error, setError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("obrera@grantlane.local");
  const [loginPassword, setLoginPassword] = useState("nightshift063");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerOrganization, setRegisterOrganization] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [reviewForm, setReviewForm] = useState<ReviewFormState>({
    conflictFlag: false,
    notes: "",
    recommendation: "revise",
    scores: {},
  });
  const [reassignTargets, setReassignTargets] = useState<Record<number, string>>({});
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!dashboard?.applicant) {
      return;
    }

    setDraftForm(fromSubmissionRecord(dashboard.applicant.draft, dashboard.user));
  }, [dashboard?.applicant?.draft?.id, dashboard?.user.id]);

  useEffect(() => {
    const assignments = dashboard?.reviewer?.assignments ?? [];
    if (assignments.length === 0) {
      setSelectedAssignmentId(null);
      return;
    }

    if (!selectedAssignmentId || !assignments.some((item) => item.assignmentId === selectedAssignmentId)) {
      setSelectedAssignmentId(assignments[0].assignmentId);
    }
  }, [dashboard?.reviewer?.assignments, selectedAssignmentId]);

  const selectedAssignment = useMemo(() => {
    if (!dashboard?.reviewer || !selectedAssignmentId) {
      return null;
    }

    return (
      dashboard.reviewer.assignments.find((assignment) => assignment.assignmentId === selectedAssignmentId) ??
      null
    );
  }, [dashboard?.reviewer, selectedAssignmentId]);

  useEffect(() => {
    if (!selectedAssignment || !dashboard) {
      return;
    }

    setReviewForm(fromAssignment(selectedAssignment, dashboard.rubric));
  }, [selectedAssignment, dashboard?.rubric]);

  useEffect(() => {
    const queue = dashboard?.coordinator?.balanceQueue ?? [];
    if (queue.length === 0) {
      setReassignTargets({});
      return;
    }

    setReassignTargets((current) => {
      const next: Record<number, string> = {};

      for (const item of queue) {
        next[item.assignmentId] =
          current[item.assignmentId] ??
          String(item.suggestedReviewerId ?? item.currentReviewerId);
      }

      return next;
    });
  }, [dashboard?.coordinator?.balanceQueue]);

  const currentUser = dashboard?.user ?? user;
  const metrics = useMemo(() => computeMetrics(dashboard), [dashboard]);
  const reviewPreviewScore = useMemo(() => {
    if (!dashboard) {
      return 0;
    }

    return calculateWeightedScore(dashboard.rubric, reviewForm.scores);
  }, [dashboard, reviewForm.scores]);

  async function bootstrap() {
    try {
      const session = await api<SessionResponse>("/api/session");
      setUser(session.user);

      if (session.user) {
        await refreshDashboard();
      }
    } catch (nextError) {
      setError(toMessage(nextError));
    } finally {
      setSessionChecked(true);
    }
  }

  async function refreshDashboard() {
    const nextDashboard = await api<DashboardData>("/api/dashboard");
    setDashboard(nextDashboard);
    setUser(nextDashboard.user);
  }

  async function runAction(label: string, work: () => Promise<void>) {
    setBusyLabel(label);
    setError(null);

    try {
      await work();
    } catch (nextError) {
      setError(toMessage(nextError));
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("Signing in", async () => {
      const response = await api<{ user: SessionUser }>("/api/login", {
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setUser(response.user);
      await refreshDashboard();
    });
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("Creating account", async () => {
      const response = await api<{ user: SessionUser }>("/api/register", {
        body: JSON.stringify({
          email: registerEmail,
          name: registerName,
          organization: registerOrganization,
          password: registerPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setUser(response.user);
      setAuthMode("signin");
      await refreshDashboard();
    });
  }

  async function handleLogout() {
    await runAction("Logging out", async () => {
      await api("/api/logout", { method: "POST" });
      setDashboard(null);
      setUser(null);
      setDraftForm(blankDraft(null));
    });
  }

  async function handleSubmission(action: "draft" | "submit") {
    await runAction(action === "submit" ? "Submitting application" : "Saving draft", async () => {
      const payload = {
        action,
        budgetLines: draftForm.budgetLines.map((line) => ({
          amount: Number(line.amount || 0),
          label: line.label,
        })),
        budgetTotal: Number(draftForm.budgetTotal || 0),
        id: draftForm.id,
        milestones: draftForm.milestones,
        organization: draftForm.organization,
        summary: draftForm.summary,
        tags: draftForm.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        title: draftForm.title,
      };

      const nextDashboard = await api<DashboardData>("/api/submissions", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setDashboard(nextDashboard);
      setUser(nextDashboard.user);
    });
  }

  async function handleReviewSubmit() {
    if (!selectedAssignment) {
      return;
    }

    await runAction("Saving review", async () => {
      const nextDashboard = await api<DashboardData>(
        `/api/assignments/${selectedAssignment.assignmentId}/review`,
        {
          body: JSON.stringify({
            conflictFlag: reviewForm.conflictFlag,
            notes: reviewForm.notes,
            recommendation: reviewForm.recommendation,
            scores: reviewForm.scores,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      setDashboard(nextDashboard);
      setUser(nextDashboard.user);
    });
  }

  async function handleReassign(item: BalanceQueueItem) {
    const nextReviewerId = Number(reassignTargets[item.assignmentId] ?? item.currentReviewerId);

    await runAction("Rebalancing assignment", async () => {
      const nextDashboard = await api<DashboardData>(
        `/api/assignments/${item.assignmentId}/reassign`,
        {
          body: JSON.stringify({ reviewerId: nextReviewerId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      setDashboard(nextDashboard);
      setUser(nextDashboard.user);
    });
  }

  async function handleEscalate(assignmentId: number) {
    await runAction("Escalating deadline", async () => {
      const nextDashboard = await api<DashboardData>(
        `/api/assignments/${assignmentId}/escalate`,
        {
          body: JSON.stringify({ note: "Coordinator escalation from GrantLane build 063." }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      setDashboard(nextDashboard);
      setUser(nextDashboard.user);
    });
  }

  async function handleDecision(submissionId: number, decision: FinalDecision) {
    await runAction(`Setting ${decision} decision`, async () => {
      const nextDashboard = await api<DashboardData>(
        `/api/submissions/${submissionId}/decision`,
        {
          body: JSON.stringify({
            decision,
            note:
              decision === "fund"
                ? "Greenlit for award memo."
                : decision === "hold"
                  ? "Hold for coordinator discussion."
                  : "Declined in coordinator queue.",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      setDashboard(nextDashboard);
      setUser(nextDashboard.user);
    });
  }

  if (!sessionChecked) {
    return (
      <Shell>
        <div className="loading-screen">Loading GrantLane dossier…</div>
      </Shell>
    );
  }

  if (!currentUser || !dashboard) {
    return (
      <Shell>
        <AuthScreen
          authMode={authMode}
          busyLabel={busyLabel}
          error={error}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          onLogin={handleLogin}
          onRegister={handleRegister}
          registerEmail={registerEmail}
          registerName={registerName}
          registerOrganization={registerOrganization}
          registerPassword={registerPassword}
          seedSelect={(account) => {
            setAuthMode("signin");
            setLoginEmail(account.email);
            setLoginPassword(account.password);
          }}
          setAuthMode={setAuthMode}
          setLoginEmail={setLoginEmail}
          setLoginPassword={setLoginPassword}
          setRegisterEmail={setRegisterEmail}
          setRegisterName={setRegisterName}
          setRegisterOrganization={setRegisterOrganization}
          setRegisterPassword={setRegisterPassword}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="masthead">
        <div className="masthead-copy">
          <p className="eyebrow">Nightshift Build 063</p>
          <h1>GrantLane</h1>
          <p className="lead">
            A dark review desk for document-heavy grant rounds, built around balanced reviewer loads,
            weighted rubric scoring, and deadline escalation.
          </p>
        </div>
        <div className="masthead-meta">
          <div className="identity-card">
            <span>{currentUser.name}</span>
            <small>{currentUser.role}</small>
            <small>{currentUser.organization}</small>
          </div>
          <button className="secondary-button" disabled={Boolean(busyLabel)} onClick={handleLogout} type="button">
            {busyLabel === "Logging out" ? "Logging out…" : "Log out"}
          </button>
        </div>
      </header>

      <section className="metric-strip">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
            <span>{metric.caption}</span>
          </article>
        ))}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="intro-grid">
        <Panel
          subtitle={roleSubtitle(currentUser.role)}
          title={roleTitle(currentUser.role)}
        >
          <p className="body-copy">{roleNarrative(currentUser.role)}</p>
          <div className="tag-row">
            <Tag label={currentUser.role} tone="neutral" />
            <Tag label="Persisted auth" tone="cool" />
            <Tag label="SQLite audit trail" tone="warm" />
          </div>
        </Panel>
        <Panel subtitle="Recent activity" title="Audit Ledger">
          <ActivityFeed items={dashboard.activity} />
        </Panel>
      </section>

      {dashboard.applicant ? (
        <ApplicantWorkspace
          busyLabel={busyLabel}
          draftForm={draftForm}
          onBudgetLineAdd={() =>
            setDraftForm((current) => ({
              ...current,
              budgetLines: [...current.budgetLines, { amount: "", label: "" }],
            }))
          }
          onBudgetLineChange={(index, field, value) =>
            setDraftForm((current) => ({
              ...current,
              budgetLines: current.budgetLines.map((line, lineIndex) =>
                lineIndex === index ? { ...line, [field]: value } : line,
              ),
            }))
          }
          onBudgetLineRemove={(index) =>
            setDraftForm((current) => ({
              ...current,
              budgetLines: current.budgetLines.filter((_, lineIndex) => lineIndex !== index),
            }))
          }
          onMilestoneAdd={() =>
            setDraftForm((current) => ({
              ...current,
              milestones: [...current.milestones, { dueDate: "", note: "", title: "" }],
            }))
          }
          onMilestoneChange={(index, field, value) =>
            setDraftForm((current) => ({
              ...current,
              milestones: current.milestones.map((milestone, milestoneIndex) =>
                milestoneIndex === index ? { ...milestone, [field]: value } : milestone,
              ),
            }))
          }
          onMilestoneRemove={(index) =>
            setDraftForm((current) => ({
              ...current,
              milestones: current.milestones.filter((_, milestoneIndex) => milestoneIndex !== index),
            }))
          }
          onSaveDraft={() => void handleSubmission("draft")}
          onSubmitFinal={() => void handleSubmission("submit")}
          setDraftForm={setDraftForm}
          view={dashboard.applicant}
        />
      ) : null}

      {dashboard.reviewer ? (
        <ReviewerWorkspace
          busyLabel={busyLabel}
          onReviewSubmit={() => void handleReviewSubmit()}
          reviewForm={reviewForm}
          reviewPreviewScore={reviewPreviewScore}
          rubric={dashboard.rubric}
          selectedAssignment={selectedAssignment}
          selectedAssignmentId={selectedAssignmentId}
          setReviewForm={setReviewForm}
          setSelectedAssignmentId={setSelectedAssignmentId}
          view={dashboard.reviewer}
        />
      ) : null}

      {dashboard.coordinator ? (
        <CoordinatorWorkspace
          busyLabel={busyLabel}
          onDecision={(submissionId, decision) => void handleDecision(submissionId, decision)}
          onEscalate={(assignmentId) => void handleEscalate(assignmentId)}
          onReassign={(item) => void handleReassign(item)}
          reassignTargets={reassignTargets}
          setReassignTargets={setReassignTargets}
          view={dashboard.coordinator}
        />
      ) : null}
    </Shell>
  );
}

function ApplicantWorkspace(props: {
  busyLabel: string | null;
  draftForm: DraftFormState;
  onBudgetLineAdd: () => void;
  onBudgetLineChange: (index: number, field: keyof DraftLineState, value: string) => void;
  onBudgetLineRemove: (index: number) => void;
  onMilestoneAdd: () => void;
  onMilestoneChange: (index: number, field: keyof DraftMilestoneState, value: string) => void;
  onMilestoneRemove: (index: number) => void;
  onSaveDraft: () => void;
  onSubmitFinal: () => void;
  setDraftForm: React.Dispatch<React.SetStateAction<DraftFormState>>;
  view: ApplicantView;
}) {
  const { busyLabel, draftForm, setDraftForm, view } = props;

  return (
    <section className="workspace-grid applicant-layout">
      <Panel subtitle="Draft and final submit" title="Application Manuscript">
        <div className="form-grid">
          <Field label="Proposal title">
            <input
              value={draftForm.title}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="e.g. Riverside Oral History Atlas"
            />
          </Field>
          <Field label="Applicant organization">
            <input
              value={draftForm.organization}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, organization: event.target.value }))
              }
              placeholder="North Canal Lab"
            />
          </Field>
        </div>

        <Field label="Summary">
          <textarea
            rows={6}
            value={draftForm.summary}
            onChange={(event) =>
              setDraftForm((current) => ({ ...current, summary: event.target.value }))
            }
            placeholder="Describe the public outcome, who benefits, and what makes this proposal urgent."
          />
        </Field>

        <div className="form-grid">
          <Field label="Total budget request">
            <input
              inputMode="decimal"
              value={draftForm.budgetTotal}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, budgetTotal: event.target.value }))
              }
              placeholder="62000"
            />
          </Field>
          <Field label="Tags">
            <input
              value={draftForm.tagsText}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, tagsText: event.target.value }))
              }
              placeholder="archives, public-memory, oral-history"
            />
          </Field>
        </div>

        <div className="subsection-head">
          <h3>Budget lines</h3>
          <button className="secondary-button" onClick={props.onBudgetLineAdd} type="button">
            Add line
          </button>
        </div>
        <div className="line-stack">
          {draftForm.budgetLines.map((line, index) => (
            <div className="line-row" key={`budget-${index}`}>
              <input
                value={line.label}
                onChange={(event) => props.onBudgetLineChange(index, "label", event.target.value)}
                placeholder="Line item"
              />
              <input
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => props.onBudgetLineChange(index, "amount", event.target.value)}
                placeholder="Amount"
              />
              <button className="secondary-button" onClick={() => props.onBudgetLineRemove(index)} type="button">
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="subsection-head">
          <h3>Milestones</h3>
          <button className="secondary-button" onClick={props.onMilestoneAdd} type="button">
            Add milestone
          </button>
        </div>
        <div className="line-stack">
          {draftForm.milestones.map((milestone, index) => (
            <div className="milestone-card" key={`milestone-${index}`}>
              <div className="form-grid">
                <input
                  value={milestone.title}
                  onChange={(event) =>
                    props.onMilestoneChange(index, "title", event.target.value)
                  }
                  placeholder="Milestone title"
                />
                <input
                  type="date"
                  value={milestone.dueDate}
                  onChange={(event) =>
                    props.onMilestoneChange(index, "dueDate", event.target.value)
                  }
                />
              </div>
              <textarea
                rows={3}
                value={milestone.note}
                onChange={(event) => props.onMilestoneChange(index, "note", event.target.value)}
                placeholder="Short note for reviewers."
              />
              <button className="secondary-button" onClick={() => props.onMilestoneRemove(index)} type="button">
                Remove milestone
              </button>
            </div>
          ))}
        </div>

        <div className="button-row">
          <button disabled={Boolean(busyLabel)} onClick={props.onSaveDraft} type="button">
            {busyLabel === "Saving draft" ? "Saving…" : "Save draft"}
          </button>
          <button className="accent-button" disabled={Boolean(busyLabel)} onClick={props.onSubmitFinal} type="button">
            {busyLabel === "Submitting application" ? "Submitting…" : "Final submit"}
          </button>
        </div>
      </Panel>

      <Panel subtitle="Persisted state" title="Submission Ledger">
        <div className="stack-list">
          {view.submissions.length === 0 ? (
            <div className="empty-state">No submissions on file yet.</div>
          ) : (
            view.submissions.map((submission) => (
              <article className="ledger-card" key={submission.id}>
                <div className="ledger-head">
                  <div>
                    <h3>{submission.title}</h3>
                    <p>{formatMoney(submission.budgetTotal)} requested</p>
                  </div>
                  <StatusBadge status={submission.status} />
                </div>
                <p className="body-copy compact">{submission.summary}</p>
                <div className="tag-row">
                  {submission.tags.map((tag) => (
                    <Tag key={tag} label={tag} tone="cool" />
                  ))}
                </div>
                <p className="meta-line">
                  Updated {formatDate(submission.updatedAt, "datetime")}
                  {submission.averageScore !== null ? ` · Avg score ${submission.averageScore}` : ""}
                </p>
              </article>
            ))
          )}
        </div>
      </Panel>
    </section>
  );
}

function AuthScreen(props: {
  authMode: AuthMode;
  busyLabel: string | null;
  error: string | null;
  loginEmail: string;
  loginPassword: string;
  onLogin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRegister: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  registerEmail: string;
  registerName: string;
  registerOrganization: string;
  registerPassword: string;
  seedSelect: (account: SeedAccount) => void;
  setAuthMode: (mode: AuthMode) => void;
  setLoginEmail: (value: string) => void;
  setLoginPassword: (value: string) => void;
  setRegisterEmail: (value: string) => void;
  setRegisterName: (value: string) => void;
  setRegisterOrganization: (value: string) => void;
  setRegisterPassword: (value: string) => void;
}) {
  return (
    <section className="auth-shell">
      <article className="hero-sheet">
        <p className="eyebrow">Grant Review Platform</p>
        <h1>GrantLane</h1>
        <p className="lead">
          Built for applicants, reviewers, and coordinators who live inside the document itself rather
          than another renamed dashboard.
        </p>
        <div className="feature-column">
          <div>
            <strong>Applicant flow</strong>
            <p>Draft and final submit with budget lines, milestones, tags, and a persisted paper trail.</p>
          </div>
          <div>
            <strong>Reviewer flow</strong>
            <p>Weighted rubric scoring, recommendation capture, and conflict disclosures in one sheet.</p>
          </div>
          <div>
            <strong>Coordinator flow</strong>
            <p>Reviewer balancing, overdue escalations, and a final decision queue with a live audit ledger.</p>
          </div>
        </div>
      </article>

      <article className="auth-panel">
        <div className="toggle-row">
          <button
            className={props.authMode === "signin" ? "tab active" : "tab"}
            onClick={() => props.setAuthMode("signin")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={props.authMode === "register" ? "tab active" : "tab"}
            onClick={() => props.setAuthMode("register")}
            type="button"
          >
            Create applicant
          </button>
        </div>

        {props.authMode === "signin" ? (
          <form className="auth-form" onSubmit={(event) => void props.onLogin(event)}>
            <Field label="Email">
              <input
                type="email"
                value={props.loginEmail}
                onChange={(event) => props.setLoginEmail(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={props.loginPassword}
                onChange={(event) => props.setLoginPassword(event.target.value)}
              />
            </Field>
            <button className="accent-button" disabled={Boolean(props.busyLabel)} type="submit">
              {props.busyLabel === "Signing in" ? "Signing in…" : "Enter GrantLane"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(event) => void props.onRegister(event)}>
            <Field label="Full name">
              <input value={props.registerName} onChange={(event) => props.setRegisterName(event.target.value)} />
            </Field>
            <Field label="Organization">
              <input
                value={props.registerOrganization}
                onChange={(event) => props.setRegisterOrganization(event.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={props.registerEmail}
                onChange={(event) => props.setRegisterEmail(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={props.registerPassword}
                onChange={(event) => props.setRegisterPassword(event.target.value)}
              />
            </Field>
            <button className="accent-button" disabled={Boolean(props.busyLabel)} type="submit">
              {props.busyLabel === "Creating account" ? "Creating…" : "Create applicant account"}
            </button>
          </form>
        )}

        <div className="seed-sheet">
          <div className="subsection-head">
            <h3>Seeded logins</h3>
            <span className="muted">Password: `nightshift063`</span>
          </div>
          <div className="stack-list">
            {seedAccounts.map((account) => (
              <button
                className="seed-button"
                key={account.email}
                onClick={() => props.seedSelect(account)}
                type="button"
              >
                <span>{account.label}</span>
                <small>{account.role} · {account.email}</small>
              </button>
            ))}
          </div>
        </div>

        {props.error ? <div className="error-banner">{props.error}</div> : null}
      </article>
    </section>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <div className="empty-state">No activity yet.</div>;
  }

  return (
    <div className="stack-list">
      {items.map((item) => (
        <article className="activity-row" key={item.id}>
          <div className="activity-dot" />
          <div>
            <p className="activity-message">{item.message}</p>
            <p className="meta-line">
              {item.actorName} · {item.actorRole} · {formatDate(item.createdAt, "datetime")}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function CoordinatorWorkspace(props: {
  busyLabel: string | null;
  onDecision: (submissionId: number, decision: FinalDecision) => void;
  onEscalate: (assignmentId: number) => void;
  onReassign: (item: BalanceQueueItem) => void;
  reassignTargets: Record<number, string>;
  setReassignTargets: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  view: CoordinatorView;
}) {
  return (
    <section className="workspace-grid">
      <Panel subtitle="Load gap, reviewer pressure, and quality signal" title="Balancing Insights">
        <div className="metric-inline-grid">
          <InlineMetric label="Submitted" value={String(props.view.insights.submittedApplications)} />
          <InlineMetric label="Pending reviews" value={String(props.view.insights.pendingReviews)} />
          <InlineMetric label="Overdue" value={String(props.view.insights.overdueReviews)} />
          <InlineMetric label="Load gap" value={String(props.view.insights.loadGap)} />
          <InlineMetric label="Escalated" value={String(props.view.insights.escalatedReviews)} />
          <InlineMetric label="Conflict flags" value={String(props.view.insights.conflictFlags)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Current load</th>
                <th>Overdue</th>
                <th>Reviewed</th>
                <th>Average score</th>
              </tr>
            </thead>
            <tbody>
              {props.view.reviewerLoads.map((item) => (
                <tr key={item.reviewerId}>
                  <td>
                    <strong>{item.reviewerName}</strong>
                  </td>
                  <td>{item.currentLoad}</td>
                  <td>{item.overdueAssignments}</td>
                  <td>{item.reviewedAssignments}</td>
                  <td>{item.averageScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel subtitle="Shift work to the lightest viable reviewer" title="Assignment Balance Queue">
        <div className="stack-list">
          {props.view.balanceQueue.length === 0 ? (
            <div className="empty-state">Every assignment is already reviewed.</div>
          ) : (
            props.view.balanceQueue.map((item) => (
              <article className="ledger-card" key={item.assignmentId}>
                <div className="ledger-head">
                  <div>
                    <h3>{item.submissionTitle}</h3>
                    <p>
                      {item.currentReviewerName} · due {formatDate(item.dueAt, "datetime")}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="assign-row">
                  <select
                    value={props.reassignTargets[item.assignmentId] ?? String(item.currentReviewerId)}
                    onChange={(event) =>
                      props.setReassignTargets((current) => ({
                        ...current,
                        [item.assignmentId]: event.target.value,
                      }))
                    }
                  >
                    {props.view.reviewerOptions.map((reviewer) => (
                      <option key={reviewer.id} value={reviewer.id}>
                        {reviewer.name} · {reviewer.organization}
                      </option>
                    ))}
                  </select>
                  <button disabled={Boolean(props.busyLabel)} onClick={() => props.onReassign(item)} type="button">
                    {props.busyLabel === "Rebalancing assignment" ? "Rebalancing…" : "Reassign"}
                  </button>
                </div>
                <p className="meta-line">
                  Suggested reviewer: {item.suggestedReviewerName ?? "None available"}
                  {item.escalatedAt ? ` · Escalated ${formatDate(item.escalatedAt, "datetime")}` : ""}
                </p>
              </article>
            ))
          )}
        </div>
      </Panel>

      <Panel subtitle="Escalate late reviewers before the decision queue stalls" title="Overdue Alerts">
        <div className="stack-list">
          {props.view.overdueAlerts.length === 0 ? (
            <div className="empty-state">No overdue reviews right now.</div>
          ) : (
            props.view.overdueAlerts.map((item) => (
              <article className="ledger-card" key={item.assignmentId}>
                <div className="ledger-head">
                  <div>
                    <h3>{item.submissionTitle}</h3>
                    <p>{item.reviewerName}</p>
                  </div>
                  <StatusBadge status="overdue" />
                </div>
                <p className="meta-line">
                  Due {formatDate(item.dueAt, "datetime")}
                  {item.escalatedAt ? ` · Last escalated ${formatDate(item.escalatedAt, "datetime")}` : ""}
                </p>
                <button
                  className="accent-button"
                  disabled={Boolean(props.busyLabel)}
                  onClick={() => props.onEscalate(item.assignmentId)}
                  type="button"
                >
                  {props.busyLabel === "Escalating deadline" ? "Escalating…" : "Escalate deadline"}
                </button>
              </article>
            ))
          )}
        </div>
      </Panel>

      <Panel subtitle="Score signal and pending reviews in one decision lane" title="Final Decision Queue">
        <div className="stack-list">
          {props.view.decisionQueue.map((item) => (
            <DecisionCard
              busyLabel={props.busyLabel}
              item={item}
              onDecision={props.onDecision}
              key={item.submissionId}
            />
          ))}
        </div>
      </Panel>
    </section>
  );
}

function DecisionCard(props: {
  busyLabel: string | null;
  item: DecisionQueueItem;
  onDecision: (submissionId: number, decision: FinalDecision) => void;
}) {
  const { item } = props;

  return (
    <article className="ledger-card">
      <div className="ledger-head">
        <div>
          <h3>{item.title}</h3>
          <p>{item.applicantName}</p>
        </div>
        <StatusBadge status={item.finalDecision ?? item.status} />
      </div>
      <div className="decision-grid">
        <InlineMetric label="Budget" value={formatMoney(item.budgetTotal)} />
        <InlineMetric label="Avg score" value={item.averageScore?.toString() ?? "—"} />
        <InlineMetric label="Reviews" value={String(item.reviewCount)} />
        <InlineMetric label="Pending" value={String(item.pendingReviews)} />
      </div>
      <p className="meta-line">
        Recommendations: {recommendationLabel(item.recommendationSpread)}
      </p>
      <div className="button-row">
        <button disabled={Boolean(props.busyLabel)} onClick={() => props.onDecision(item.submissionId, "fund")} type="button">
          Fund
        </button>
        <button className="secondary-button" disabled={Boolean(props.busyLabel)} onClick={() => props.onDecision(item.submissionId, "hold")} type="button">
          Hold
        </button>
        <button className="secondary-button" disabled={Boolean(props.busyLabel)} onClick={() => props.onDecision(item.submissionId, "decline")} type="button">
          Decline
        </button>
      </div>
    </article>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="inline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ children, subtitle, title }: { children: ReactNode; subtitle: string; title: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow subtle">{subtitle}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function ReviewerWorkspace(props: {
  busyLabel: string | null;
  onReviewSubmit: () => void;
  reviewForm: ReviewFormState;
  reviewPreviewScore: number;
  rubric: RubricCriterion[];
  selectedAssignment: ReviewAssignment | null;
  selectedAssignmentId: number | null;
  setReviewForm: React.Dispatch<React.SetStateAction<ReviewFormState>>;
  setSelectedAssignmentId: React.Dispatch<React.SetStateAction<number | null>>;
  view: ReviewerView;
}) {
  return (
    <section className="workspace-grid reviewer-layout">
      <Panel subtitle="Assignments and deadline pressure" title="Reviewer Shelf">
        <div className="stack-list">
          {props.view.assignments.map((assignment) => (
            <button
              className={assignment.assignmentId === props.selectedAssignmentId ? "assignment-card active" : "assignment-card"}
              key={assignment.assignmentId}
              onClick={() => props.setSelectedAssignmentId(assignment.assignmentId)}
              type="button"
            >
              <div className="ledger-head">
                <div>
                  <h3>{assignment.title}</h3>
                  <p>{assignment.applicantName}</p>
                </div>
                <StatusBadge status={assignment.status} />
              </div>
              <p className="body-copy compact">{assignment.summary}</p>
              <p className="meta-line">
                Due {formatDate(assignment.dueAt, "datetime")}
                {assignment.existingReview ? ` · ${assignment.existingReview.recommendation}` : ""}
              </p>
            </button>
          ))}
        </div>
      </Panel>

      <Panel subtitle="Proposal dossier and weighted rubric" title="Review Sheet">
        {!props.selectedAssignment ? (
          <div className="empty-state">Select an assignment to review.</div>
        ) : (
          <>
            <article className="document-sheet">
              <div className="ledger-head">
                <div>
                  <h3>{props.selectedAssignment.title}</h3>
                  <p>{props.selectedAssignment.applicantName} · {props.selectedAssignment.applicantOrganization}</p>
                </div>
                <StatusBadge status={props.selectedAssignment.status} />
              </div>
              <p className="body-copy">{props.selectedAssignment.summary}</p>
              <div className="tag-row">
                {props.selectedAssignment.tags.map((tag) => (
                  <Tag key={tag} label={tag} tone="cool" />
                ))}
                {props.selectedAssignment.escalatedAt ? <Tag label="deadline escalated" tone="warm" /> : null}
              </div>
              <div className="two-column-list">
                <div>
                  <h3>Budget</h3>
                  <p className="meta-line">{formatMoney(props.selectedAssignment.budgetTotal)}</p>
                  <ul className="plain-list">
                    {props.selectedAssignment.budgetLines.map((line) => (
                      <li key={`${line.label}-${line.amount}`}>
                        {line.label} · {formatMoney(line.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Milestones</h3>
                  <ul className="plain-list">
                    {props.selectedAssignment.milestones.map((milestone) => (
                      <li key={`${milestone.title}-${milestone.dueDate}`}>
                        {milestone.title} · {milestone.dueDate || "TBD"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>

            <div className="review-summary-strip">
              <InlineMetric label="Weighted preview" value={String(props.reviewPreviewScore)} />
              <InlineMetric label="Due" value={formatDate(props.selectedAssignment.dueAt, "short")} />
              <InlineMetric
                label="Existing"
                value={props.selectedAssignment.existingReview?.recommendation ?? "None"}
              />
            </div>

            <div className="line-stack">
              {props.rubric.map((criterion) => (
                <article className="rubric-row" key={criterion.key}>
                  <div>
                    <h3>{criterion.label}</h3>
                    <p className="body-copy compact">{criterion.description}</p>
                  </div>
                  <div className="rubric-control">
                    <span>{criterion.weight}%</span>
                    <select
                      value={props.reviewForm.scores[criterion.key] ?? 3}
                      onChange={(event) =>
                        props.setReviewForm((current) => ({
                          ...current,
                          scores: {
                            ...current.scores,
                            [criterion.key]: Number(event.target.value),
                          },
                        }))
                      }
                    >
                      {[1, 2, 3, 4, 5].map((score) => (
                        <option key={score} value={score}>
                          {score}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>

            <div className="form-grid">
              <Field label="Recommendation">
                <select
                  value={props.reviewForm.recommendation}
                  onChange={(event) =>
                    props.setReviewForm((current) => ({
                      ...current,
                      recommendation: event.target.value as ReviewerRecommendation,
                    }))
                  }
                >
                  <option value="fund">Fund</option>
                  <option value="revise">Revise</option>
                  <option value="decline">Decline</option>
                </select>
              </Field>
              <label className="checkbox-row">
                <input
                  checked={props.reviewForm.conflictFlag}
                  onChange={(event) =>
                    props.setReviewForm((current) => ({
                      ...current,
                      conflictFlag: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>Flag conflict of interest</span>
              </label>
            </div>

            <Field label="Reviewer note">
              <textarea
                rows={5}
                value={props.reviewForm.notes}
                onChange={(event) =>
                  props.setReviewForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Capture the core justification for the recommendation."
              />
            </Field>

            <div className="button-row">
              <button className="accent-button" disabled={Boolean(props.busyLabel)} onClick={props.onReviewSubmit} type="button">
                {props.busyLabel === "Saving review" ? "Saving…" : "Save review"}
              </button>
            </div>
          </>
        )}
      </Panel>
    </section>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="app-shell">
      <div className="page-noise" />
      <div className="page-glow page-glow-a" />
      <div className="page-glow page-glow-b" />
      <div className="content">{children}</div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "fund"
      ? "positive"
      : status === "decline" || status === "overdue"
        ? "alert"
        : status === "reviewed" || status === "submitted"
          ? "cool"
          : "neutral";

  return <span className={`status-badge ${tone}`}>{status.replace(/-/g, " ")}</span>;
}

function Tag({ label, tone }: { label: string; tone: "cool" | "neutral" | "warm" }) {
  return <span className={`tag ${tone}`}>{label}</span>;
}

function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, {
    credentials: "include",
    ...init,
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Request failed with ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  });
}

function calculateWeightedScore(rubric: RubricCriterion[], scores: Record<string, number>): number {
  const total = rubric.reduce((sum, criterion) => {
    return sum + ((scores[criterion.key] ?? 3) / 5) * criterion.weight;
  }, 0);

  return Math.round(total * 10) / 10;
}

function computeMetrics(dashboard: DashboardData | null): Array<{ caption: string; label: string; value: string }> {
  if (!dashboard) {
    return [];
  }

  if (dashboard.applicant) {
    const submitted = dashboard.applicant.submissions.filter((item) => item.status !== "draft").length;
    const draftCount = dashboard.applicant.submissions.filter((item) => item.status === "draft").length;
    const awarded = dashboard.applicant.submissions.filter((item) => item.finalDecision === "fund").length;

    return [
      { caption: "Manuscripts in progress", label: "Drafts", value: String(draftCount) },
      { caption: "Applications in queue", label: "Submitted", value: String(submitted) },
      { caption: "Awards on file", label: "Funded", value: String(awarded) },
      { caption: "Audit entries", label: "Activity", value: String(dashboard.activity.length) },
    ];
  }

  if (dashboard.reviewer) {
    const overdue = dashboard.reviewer.assignments.filter((item) => item.status === "overdue").length;
    const reviewed = dashboard.reviewer.assignments.filter((item) => item.status === "reviewed").length;
    const flagged = dashboard.reviewer.assignments.filter((item) => item.existingReview?.conflictFlag).length;

    return [
      { caption: "Assignments on shelf", label: "Assigned", value: String(dashboard.reviewer.assignments.length) },
      { caption: "Reviews already written", label: "Reviewed", value: String(reviewed) },
      { caption: "Deadline pressure", label: "Overdue", value: String(overdue) },
      { caption: "Conflict flags", label: "Flagged", value: String(flagged) },
    ];
  }

  if (dashboard.coordinator) {
    return [
      {
        caption: "Applications in decision lane",
        label: "Submitted",
        value: String(dashboard.coordinator.insights.submittedApplications),
      },
      {
        caption: "Open reviewer work",
        label: "Pending",
        value: String(dashboard.coordinator.insights.pendingReviews),
      },
      {
        caption: "Immediate escalation needs",
        label: "Overdue",
        value: String(dashboard.coordinator.insights.overdueReviews),
      },
      {
        caption: "Reviewer spread delta",
        label: "Load gap",
        value: String(dashboard.coordinator.insights.loadGap),
      },
    ];
  }

  return [];
}

function formatDate(value: string, style: "datetime" | "short"): string {
  const date = new Date(value);

  if (style === "short") {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function fromAssignment(assignment: ReviewAssignment, rubric: RubricCriterion[]): ReviewFormState {
  const scores: Record<string, number> = {};
  for (const criterion of rubric) {
    scores[criterion.key] = assignment.existingReview?.scores[criterion.key] ?? 3;
  }

  return {
    conflictFlag: assignment.existingReview?.conflictFlag ?? false,
    notes: assignment.existingReview?.notes ?? "",
    recommendation: assignment.existingReview?.recommendation ?? "revise",
    scores,
  };
}

function fromSubmissionRecord(submission: SubmissionRecord | null, user: SessionUser): DraftFormState {
  if (!submission) {
    return blankDraft(user);
  }

  return {
    budgetLines:
      submission.budgetLines.length > 0
        ? submission.budgetLines.map((line) => ({ amount: String(line.amount), label: line.label }))
        : [{ amount: "", label: "" }],
    budgetTotal: String(submission.budgetTotal || ""),
    id: submission.id,
    milestones:
      submission.milestones.length > 0
        ? submission.milestones.map((milestone) => ({
            dueDate: normalizeDateInput(milestone.dueDate),
            note: milestone.note,
            title: milestone.title,
          }))
        : [{ dueDate: "", note: "", title: "" }],
    organization: submission.applicantOrganization,
    summary: submission.summary,
    tagsText: submission.tags.join(", "),
    title: submission.title,
  };
}

function normalizeDateInput(value: string): string {
  if (!value) {
    return "";
  }

  return value.includes("T") ? value.slice(0, 10) : value;
}

function recommendationLabel(spread: RecommendationSpread): string {
  return `${spread.fund} fund · ${spread.revise} revise · ${spread.decline} decline`;
}

function roleNarrative(role: SessionUser["role"]): string {
  if (role === "applicant") {
    return "Draft the proposal, tighten the budget, and push the application into the review lane when the manuscript is ready.";
  }

  if (role === "reviewer") {
    return "Read the file as a real proposal, score it against the weighted rubric, and leave a recommendation the coordinator can defend.";
  }

  return "Balance reviewer pressure, escalate slipping deadlines, and convert score signal into a clean final decision queue.";
}

function roleSubtitle(role: SessionUser["role"]): string {
  if (role === "applicant") {
    return "Applicant view";
  }

  if (role === "reviewer") {
    return "Reviewer view";
  }

  return "Coordinator view";
}

function roleTitle(role: SessionUser["role"]): string {
  if (role === "applicant") {
    return "Submission Desk";
  }

  if (role === "reviewer") {
    return "Scoring Desk";
  }

  return "Portfolio Desk";
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
