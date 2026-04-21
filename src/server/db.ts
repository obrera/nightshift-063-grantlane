import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";

export type UserRole = "applicant" | "reviewer" | "coordinator";
export type ReviewerRecommendation = "fund" | "revise" | "decline";
export type FinalDecision = "fund" | "hold" | "decline";

export type SessionUser = {
  email: string;
  id: number;
  name: string;
  organization: string;
  role: UserRole;
};

export type RubricCriterion = {
  description: string;
  key: string;
  label: string;
  weight: number;
};

export type BudgetLine = {
  amount: number;
  label: string;
};

export type Milestone = {
  dueDate: string;
  note: string;
  title: string;
};

export type RecommendationSpread = {
  decline: number;
  fund: number;
  revise: number;
};

export type SubmissionRecord = {
  applicantName: string;
  applicantOrganization: string;
  averageScore: number | null;
  budgetLines: BudgetLine[];
  budgetTotal: number;
  finalDecision: FinalDecision | null;
  id: number;
  milestones: Milestone[];
  pendingReviews: number;
  recommendationSpread: RecommendationSpread;
  reviewCount: number;
  status: "decision-made" | "draft" | "submitted";
  submittedAt: string | null;
  summary: string;
  tags: string[];
  title: string;
  updatedAt: string;
};

export type ReviewState = {
  conflictFlag: boolean;
  notes: string;
  recommendation: ReviewerRecommendation;
  scores: Record<string, number>;
  submittedAt: string;
  updatedAt: string;
  weightedScore: number;
};

export type ReviewAssignment = {
  applicantName: string;
  applicantOrganization: string;
  assignmentId: number;
  budgetLines: BudgetLine[];
  budgetTotal: number;
  dueAt: string;
  escalatedAt: string | null;
  existingReview: ReviewState | null;
  milestones: Milestone[];
  status: "overdue" | "pending" | "reviewed";
  submissionId: number;
  summary: string;
  tags: string[];
  title: string;
};

export type ReviewerView = {
  assignments: ReviewAssignment[];
};

export type ReviewerLoad = {
  averageScore: number | null;
  currentLoad: number;
  escalatedAssignments: number;
  overdueAssignments: number;
  pendingAssignments: number;
  reviewedAssignments: number;
  reviewerId: number;
  reviewerName: string;
};

export type BalanceQueueItem = {
  assignmentId: number;
  currentReviewerId: number;
  currentReviewerName: string;
  dueAt: string;
  escalatedAt: string | null;
  status: "overdue" | "pending";
  submissionId: number;
  submissionTitle: string;
  suggestedReviewerId: number | null;
  suggestedReviewerName: string | null;
};

export type OverdueAlert = {
  assignmentId: number;
  dueAt: string;
  escalatedAt: string | null;
  reviewerName: string;
  submissionTitle: string;
};

export type DecisionQueueItem = {
  applicantName: string;
  averageScore: number | null;
  budgetTotal: number;
  finalDecision: FinalDecision | null;
  pendingReviews: number;
  recommendationSpread: RecommendationSpread;
  reviewCount: number;
  status: "decision-made" | "submitted";
  submissionId: number;
  submittedAt: string | null;
  title: string;
};

export type CoordinatorView = {
  balanceQueue: BalanceQueueItem[];
  decisionQueue: DecisionQueueItem[];
  insights: {
    conflictFlags: number;
    escalatedReviews: number;
    loadGap: number;
    overdueReviews: number;
    pendingReviews: number;
    submittedApplications: number;
  };
  overdueAlerts: OverdueAlert[];
  reviewerLoads: ReviewerLoad[];
  reviewerOptions: Array<Pick<SessionUser, "id" | "name" | "organization">>;
};

export type ApplicantView = {
  draft: SubmissionRecord | null;
  submissions: SubmissionRecord[];
};

export type ActivityItem = {
  actionType: string;
  actorName: string;
  actorRole: UserRole;
  createdAt: string;
  entityType: string;
  id: number;
  message: string;
};

export type DashboardData = {
  activity: ActivityItem[];
  applicant: ApplicantView | null;
  coordinator: CoordinatorView | null;
  generatedAt: string;
  reviewer: ReviewerView | null;
  rubric: RubricCriterion[];
  user: SessionUser;
};

type SqlParam = number | string | null;

type UserRow = {
  email: string;
  id: number;
  name: string;
  organization: string;
  role: UserRole;
};

type SubmissionRow = {
  applicantId: number;
  applicantName: string;
  applicantOrganization: string;
  budgetLinesJson: string;
  budgetTotal: number;
  finalDecision: FinalDecision | null;
  id: number;
  milestonesJson: string;
  status: "decision-made" | "draft" | "submitted";
  submittedAt: string | null;
  summary: string;
  tagsJson: string;
  title: string;
  updatedAt: string;
};

type AssignmentRow = {
  assignedAt: string;
  assignmentId: number;
  dueAt: string;
  escalatedAt: string | null;
  reviewerId: number;
  reviewerName: string;
  reviewNotes: string | null;
  reviewSubmittedAt: string | null;
  reviewUpdatedAt: string | null;
  reviewerOrganization: string;
  rubricJson: string | null;
  scoreValue: number | null;
  status: "pending" | "reviewed";
  submissionId: number;
  reviewConflictFlag: number | null;
  reviewRecommendation: ReviewerRecommendation | null;
};

const RUBRIC: RubricCriterion[] = [
  {
    description: "Is the proposal likely to create durable public value?",
    key: "publicValue",
    label: "Public value",
    weight: 35,
  },
  {
    description: "Can this team execute the work with the plan provided?",
    key: "execution",
    label: "Execution",
    weight: 25,
  },
  {
    description: "Does the proposal expand access for the intended communities?",
    key: "equity",
    label: "Equity reach",
    weight: 20,
  },
  {
    description: "Is the budget disciplined enough for the requested grant size?",
    key: "stewardship",
    label: "Budget stewardship",
    weight: 20,
  },
];

export class AppDb {
  private constructor(
    private readonly db: Database,
    private readonly filePath: string,
    private readonly SQL: SqlJsStatic,
  ) {}

  static async create(): Promise<AppDb> {
    const SQL = await initSqlJs();
    const filePath = path.join(process.cwd(), "data", "grantlane.sqlite");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const db = fs.existsSync(filePath)
      ? new SQL.Database(fs.readFileSync(filePath))
      : new SQL.Database();

    const appDb = new AppDb(db, filePath, SQL);
    appDb.migrate();
    appDb.seedIfNeeded();
    appDb.persist();
    return appDb;
  }

  createSession(userId: number): string {
    const token = crypto.randomBytes(24).toString("hex");
    const statement = this.db.prepare(
      "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
    );
    statement.run([token, userId, this.now()]);
    statement.free();
    this.persist();
    return token;
  }

  deleteSession(token: string): void {
    const statement = this.db.prepare("DELETE FROM sessions WHERE token = ?");
    statement.run([token]);
    statement.free();
    this.persist();
  }

  getDashboard(userId: number): DashboardData {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const submissions = this.getSubmissionRecords();
    const assignments = this.getAssignmentRows();

    return {
      activity: this.getRecentActivity(18),
      applicant: user.role === "applicant" ? this.buildApplicantView(user, submissions) : null,
      coordinator:
        user.role === "coordinator"
          ? this.buildCoordinatorView(submissions, assignments)
          : null,
      generatedAt: this.now(),
      reviewer: user.role === "reviewer" ? this.buildReviewerView(user, submissions, assignments) : null,
      rubric: RUBRIC,
      user,
    };
  }

  getUserBySession(token: string): SessionUser | null {
    const row = this.queryOne<UserRow>(
      `
        SELECT u.id, u.email, u.name, u.role, u.organization
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
      `,
      [token],
    );

    return row ? this.mapUser(row) : null;
  }

  login(email: string, password: string): SessionUser | null {
    const row = this.queryOne<UserRow>(
      `
        SELECT id, email, name, role, organization
        FROM users
        WHERE email = ? AND password_hash = ?
      `,
      [email.trim().toLowerCase(), this.hash(password)],
    );

    return row ? this.mapUser(row) : null;
  }

  registerApplicant(input: {
    email: string;
    name: string;
    organization: string;
    password: string;
  }): SessionUser {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const organization = input.organization.trim();
    const password = input.password;

    if (!email || !name || !organization || password.length < 8) {
      throw new Error("Registration requires name, organization, email, and an 8+ character password.");
    }

    const exists = this.queryOne<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]);
    if (exists) {
      throw new Error("An account already exists for that email.");
    }

    const statement = this.db.prepare(
      `
        INSERT INTO users (email, name, role, organization, password_hash, created_at)
        VALUES (?, ?, 'applicant', ?, ?, ?)
      `,
    );
    statement.run([email, name, organization, this.hash(password), this.now()]);
    statement.free();
    this.persist();

    const user = this.queryOne<UserRow>(
      "SELECT id, email, name, role, organization FROM users WHERE email = ?",
      [email],
    );

    if (!user) {
      throw new Error("Registration succeeded but the new account could not be loaded.");
    }

    this.insertActivity(user.id, "register", "user", user.id, `${name} opened a new applicant account.`, false);
    this.persist();
    return this.mapUser(user);
  }

  saveSubmission(
    applicantId: number,
    input: {
      action: "draft" | "submit";
      budgetLines: BudgetLine[];
      budgetTotal: number;
      id?: number;
      milestones: Milestone[];
      organization: string;
      summary: string;
      tags: string[];
      title: string;
    },
  ): void {
    const user = this.getUserById(applicantId);
    if (!user || user.role !== "applicant") {
      throw new Error("Only applicants can edit submissions.");
    }

    const title = input.title.trim();
    const organization = input.organization.trim() || user.organization;
    const summary = input.summary.trim();
    const tags = this.sanitizeTags(input.tags);
    const milestones = this.sanitizeMilestones(input.milestones);
    const budgetLines = this.sanitizeBudgetLines(input.budgetLines);
    const budgetTotal = Number.isFinite(input.budgetTotal) ? Math.max(input.budgetTotal, 0) : 0;

    if (input.action === "submit") {
      if (!title || !organization || !summary || budgetTotal <= 0 || budgetLines.length === 0) {
        throw new Error("Final submit requires title, organization, summary, and budget details.");
      }

      if (milestones.length === 0 || tags.length === 0) {
        throw new Error("Final submit requires at least one milestone and one tag.");
      }
    }

    const now = this.now();
    const status = input.action === "submit" ? "submitted" : "draft";
    let submissionId = input.id ?? null;
    let previousStatus: string | null = null;

    if (submissionId) {
      const existing = this.queryOne<{ applicantId: number; status: string }>(
        "SELECT applicant_id AS applicantId, status FROM submissions WHERE id = ?",
        [submissionId],
      );

      if (!existing || existing.applicantId !== applicantId) {
        throw new Error("Submission not found for this applicant.");
      }

      if (existing.status !== "draft") {
        throw new Error("Submitted applications are locked for applicants.");
      }

      previousStatus = existing.status;
      const statement = this.db.prepare(
        `
          UPDATE submissions
          SET title = ?, organization = ?, summary = ?, budget_total = ?, budget_lines_json = ?,
              milestones_json = ?, tags_json = ?, status = ?, submitted_at = ?, updated_at = ?
          WHERE id = ?
        `,
      );
      statement.run([
        title || "Untitled draft",
        organization,
        summary,
        budgetTotal,
        JSON.stringify(budgetLines),
        JSON.stringify(milestones),
        JSON.stringify(tags),
        status,
        input.action === "submit" ? now : null,
        now,
        submissionId,
      ]);
      statement.free();
    } else {
      const statement = this.db.prepare(
        `
          INSERT INTO submissions (
            applicant_id,
            title,
            organization,
            summary,
            budget_total,
            budget_lines_json,
            milestones_json,
            tags_json,
            status,
            submitted_at,
            updated_at,
            final_decision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
      );
      statement.run([
        applicantId,
        title || "Untitled draft",
        organization,
        summary,
        budgetTotal,
        JSON.stringify(budgetLines),
        JSON.stringify(milestones),
        JSON.stringify(tags),
        status,
        input.action === "submit" ? now : null,
        now,
      ]);
      statement.free();

      const inserted = this.queryOne<{ id: number }>(
        "SELECT id FROM submissions WHERE applicant_id = ? ORDER BY id DESC LIMIT 1",
        [applicantId],
      );
      submissionId = inserted?.id ?? null;
    }

    if (!submissionId) {
      throw new Error("Submission could not be saved.");
    }

    const organizationStatement = this.db.prepare("UPDATE users SET organization = ? WHERE id = ?");
    organizationStatement.run([organization, applicantId]);
    organizationStatement.free();

    if (input.action === "submit") {
      this.ensureInitialAssignments(submissionId);
    }

    const label = title || "Untitled draft";
    const message =
      input.action === "submit"
        ? `${user.name} submitted ${label} for review.`
        : `${user.name} saved a draft for ${label}.`;
    this.insertActivity(
      user.id,
      input.action === "submit" ? "submit-application" : "save-draft",
      "submission",
      submissionId,
      message,
      false,
    );

    if (previousStatus === "draft" && input.action === "submit") {
      this.insertActivity(
        this.getDefaultCoordinatorId(),
        "queue-reviewers",
        "submission",
        submissionId,
        `Ana Obrera queued two reviewers for ${label}.`,
        false,
      );
    }

    this.persist();
  }

  saveReview(
    reviewerId: number,
    assignmentId: number,
    input: {
      conflictFlag: boolean;
      notes: string;
      recommendation: ReviewerRecommendation;
      scores: Record<string, number>;
    },
  ): void {
    const reviewer = this.getUserById(reviewerId);
    if (!reviewer || reviewer.role !== "reviewer") {
      throw new Error("Only reviewers can submit scores.");
    }

    const assignment = this.queryOne<{
      reviewerId: number;
      submissionId: number;
      title: string;
    }>(
      `
        SELECT a.reviewer_id AS reviewerId, a.submission_id AS submissionId, s.title
        FROM assignments a
        INNER JOIN submissions s ON s.id = a.submission_id
        WHERE a.id = ?
      `,
      [assignmentId],
    );

    if (!assignment || assignment.reviewerId !== reviewerId) {
      throw new Error("Assignment not found for this reviewer.");
    }

    const recommendation = input.recommendation;
    if (!["fund", "revise", "decline"].includes(recommendation)) {
      throw new Error("Recommendation must be fund, revise, or decline.");
    }

    const scores = this.normalizeRubricScores(input.scores);
    const weightedScore = this.calculateWeightedScore(scores);
    const notes = input.notes.trim();
    const now = this.now();
    const existing = this.queryOne<{ id: number }>(
      "SELECT id FROM reviews WHERE assignment_id = ?",
      [assignmentId],
    );

    if (existing) {
      const statement = this.db.prepare(
        `
          UPDATE reviews
          SET recommendation = ?, conflict_flag = ?, rubric_json = ?, weighted_score = ?,
              notes = ?, submitted_at = ?, updated_at = ?
          WHERE assignment_id = ?
        `,
      );
      statement.run([
        recommendation,
        input.conflictFlag ? 1 : 0,
        JSON.stringify(scores),
        weightedScore,
        notes,
        now,
        now,
        assignmentId,
      ]);
      statement.free();
    } else {
      const statement = this.db.prepare(
        `
          INSERT INTO reviews (
            assignment_id,
            reviewer_id,
            recommendation,
            conflict_flag,
            rubric_json,
            weighted_score,
            notes,
            submitted_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      statement.run([
        assignmentId,
        reviewerId,
        recommendation,
        input.conflictFlag ? 1 : 0,
        JSON.stringify(scores),
        weightedScore,
        notes,
        now,
        now,
      ]);
      statement.free();
    }

    const assignmentStatement = this.db.prepare("UPDATE assignments SET status = 'reviewed' WHERE id = ?");
    assignmentStatement.run([assignmentId]);
    assignmentStatement.free();

    const suffix = input.conflictFlag ? " and flagged a conflict of interest." : ".";
    this.insertActivity(
      reviewer.id,
      "submit-review",
      "assignment",
      assignmentId,
      `${reviewer.name} submitted a ${recommendation} recommendation for ${assignment.title}${suffix}`,
      false,
    );
    this.persist();
  }

  reassignAssignment(coordinatorId: number, assignmentId: number, reviewerId: number): void {
    const coordinator = this.getUserById(coordinatorId);
    if (!coordinator || coordinator.role !== "coordinator") {
      throw new Error("Only coordinators can rebalance assignments.");
    }

    const assignment = this.queryOne<{
      reviewerId: number;
      submissionId: number;
      title: string;
    }>(
      `
        SELECT a.reviewer_id AS reviewerId, a.submission_id AS submissionId, s.title
        FROM assignments a
        INNER JOIN submissions s ON s.id = a.submission_id
        WHERE a.id = ?
      `,
      [assignmentId],
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    const reviewExists = this.queryOne<{ id: number }>(
      "SELECT id FROM reviews WHERE assignment_id = ?",
      [assignmentId],
    );
    if (reviewExists) {
      throw new Error("Reviewed assignments cannot be rebalanced.");
    }

    const reviewer = this.getUserById(reviewerId);
    if (!reviewer || reviewer.role !== "reviewer") {
      throw new Error("Reviewer not found.");
    }

    if (assignment.reviewerId === reviewerId) {
      return;
    }

    const sameSubmission = this.queryOne<{ id: number }>(
      "SELECT id FROM assignments WHERE submission_id = ? AND reviewer_id = ? AND id != ?",
      [assignment.submissionId, reviewerId, assignmentId],
    );
    if (sameSubmission) {
      throw new Error("That reviewer is already assigned to this application.");
    }

    const statement = this.db.prepare(
      `
        UPDATE assignments
        SET reviewer_id = ?, assigned_by = ?, assigned_at = ?, status = 'pending'
        WHERE id = ?
      `,
    );
    statement.run([reviewerId, coordinatorId, this.now(), assignmentId]);
    statement.free();

    this.insertActivity(
      coordinator.id,
      "rebalance",
      "assignment",
      assignmentId,
      `${coordinator.name} rebalanced ${assignment.title} to ${reviewer.name}.`,
      false,
    );
    this.persist();
  }

  escalateAssignment(coordinatorId: number, assignmentId: number, note: string): void {
    const coordinator = this.getUserById(coordinatorId);
    if (!coordinator || coordinator.role !== "coordinator") {
      throw new Error("Only coordinators can escalate deadlines.");
    }

    const assignment = this.queryOne<{
      title: string;
      reviewerName: string;
    }>(
      `
        SELECT s.title, u.name AS reviewerName
        FROM assignments a
        INNER JOIN submissions s ON s.id = a.submission_id
        INNER JOIN users u ON u.id = a.reviewer_id
        WHERE a.id = ?
      `,
      [assignmentId],
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    const statement = this.db.prepare(
      "UPDATE assignments SET escalated_at = ?, escalation_note = ? WHERE id = ?",
    );
    statement.run([this.now(), note.trim() || "Coordinator escalation requested.", assignmentId]);
    statement.free();

    this.insertActivity(
      coordinator.id,
      "escalate-deadline",
      "assignment",
      assignmentId,
      `${coordinator.name} escalated ${assignment.reviewerName}'s review deadline for ${assignment.title}.`,
      false,
    );
    this.persist();
  }

  setFinalDecision(
    coordinatorId: number,
    submissionId: number,
    decision: FinalDecision,
    note: string,
  ): void {
    const coordinator = this.getUserById(coordinatorId);
    if (!coordinator || coordinator.role !== "coordinator") {
      throw new Error("Only coordinators can finalize decisions.");
    }

    if (!["fund", "hold", "decline"].includes(decision)) {
      throw new Error("Decision must be fund, hold, or decline.");
    }

    const submission = this.queryOne<{ title: string }>(
      "SELECT title FROM submissions WHERE id = ?",
      [submissionId],
    );
    if (!submission) {
      throw new Error("Submission not found.");
    }

    const statement = this.db.prepare(
      "UPDATE submissions SET status = 'decision-made', final_decision = ?, updated_at = ? WHERE id = ?",
    );
    statement.run([decision, this.now(), submissionId]);
    statement.free();

    const noteSuffix = note.trim() ? ` Note: ${note.trim()}` : "";
    this.insertActivity(
      coordinator.id,
      "final-decision",
      "submission",
      submissionId,
      `${coordinator.name} marked ${submission.title} as ${decision}.${noteSuffix}`,
      false,
    );
    this.persist();
  }

  private buildApplicantView(user: SessionUser, submissions: SubmissionRecord[]): ApplicantView {
    const ownSubmissions = submissions
      .filter((submission) => submission.applicantName === user.name)
      .sort((left, right) => this.sortByRecent(right.updatedAt, left.updatedAt));

    const draft =
      ownSubmissions
        .filter((submission) => submission.status === "draft")
        .sort((left, right) => this.sortByRecent(right.updatedAt, left.updatedAt))[0] ?? null;

    return {
      draft,
      submissions: ownSubmissions,
    };
  }

  private buildCoordinatorView(
    submissions: SubmissionRecord[],
    assignments: AssignmentRow[],
  ): CoordinatorView {
    const reviewerOptions = this.queryAll<UserRow>(
      `
        SELECT id, email, name, role, organization
        FROM users
        WHERE role = 'reviewer'
        ORDER BY name ASC
      `,
    ).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      organization: String(row.organization),
    }));

    const reviewerLoads = reviewerOptions.map((reviewer) => {
      const reviewerAssignments = assignments.filter((assignment) => assignment.reviewerId === reviewer.id);
      const pendingAssignments = reviewerAssignments.filter(
        (assignment) => this.deriveAssignmentStatus(assignment) === "pending",
      ).length;
      const overdueAssignments = reviewerAssignments.filter(
        (assignment) => this.deriveAssignmentStatus(assignment) === "overdue",
      ).length;
      const reviewedAssignments = reviewerAssignments.filter(
        (assignment) => this.deriveAssignmentStatus(assignment) === "reviewed",
      ).length;
      const escalatedAssignments = reviewerAssignments.filter((assignment) => assignment.escalatedAt).length;
      const reviewedScores = reviewerAssignments
        .map((assignment) => assignment.scoreValue)
        .filter((value): value is number => typeof value === "number");

      return {
        averageScore: reviewedScores.length ? this.round(reviewedScores.reduce((sum, value) => sum + value, 0) / reviewedScores.length) : null,
        currentLoad: reviewerAssignments.filter(
          (assignment) => this.deriveAssignmentStatus(assignment) !== "reviewed",
        ).length,
        escalatedAssignments,
        overdueAssignments,
        pendingAssignments,
        reviewedAssignments,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
      };
    });

    const reviewerLoadMap = new Map(reviewerLoads.map((item) => [item.reviewerId, item.currentLoad]));
    const submissionsById = new Map(submissions.map((submission) => [submission.id, submission]));

    const balanceQueue = assignments
      .filter((assignment) => this.deriveAssignmentStatus(assignment) !== "reviewed")
      .map((assignment) => {
        const submission = submissionsById.get(assignment.submissionId);
        if (!submission) {
          throw new Error(`Missing submission ${assignment.submissionId}`);
        }

        const occupiedReviewerIds = new Set(
          assignments
            .filter((item) => item.submissionId === assignment.submissionId)
            .map((item) => item.reviewerId),
        );

        const suggested = reviewerOptions
          .filter((reviewer) => !occupiedReviewerIds.has(reviewer.id))
          .sort((left, right) => {
            const leftLoad = reviewerLoadMap.get(left.id) ?? 0;
            const rightLoad = reviewerLoadMap.get(right.id) ?? 0;
            if (leftLoad !== rightLoad) {
              return leftLoad - rightLoad;
            }
            return left.name.localeCompare(right.name);
          })[0];

        const nextStatus = this.deriveAssignmentStatus(assignment);
        if (nextStatus === "reviewed") {
          throw new Error(`Unexpected reviewed assignment in balance queue ${assignment.assignmentId}`);
        }

        return {
          assignmentId: assignment.assignmentId,
          currentReviewerId: assignment.reviewerId,
          currentReviewerName: assignment.reviewerName,
          dueAt: assignment.dueAt,
          escalatedAt: assignment.escalatedAt,
          status: nextStatus,
          submissionId: assignment.submissionId,
          submissionTitle: submission.title,
          suggestedReviewerId: suggested?.id ?? null,
          suggestedReviewerName: suggested?.name ?? null,
        } satisfies BalanceQueueItem;
      })
      .sort((left, right) => {
        const leftWeight = left.status === "overdue" ? 0 : 1;
        const rightWeight = right.status === "overdue" ? 0 : 1;
        if (leftWeight !== rightWeight) {
          return leftWeight - rightWeight;
        }
        return left.dueAt.localeCompare(right.dueAt);
      });

    const overdueAlerts = balanceQueue
      .filter((item) => item.status === "overdue")
      .map((item) => ({
        assignmentId: item.assignmentId,
        dueAt: item.dueAt,
        escalatedAt: item.escalatedAt,
        reviewerName: item.currentReviewerName,
        submissionTitle: item.submissionTitle,
      }));

    const decisionQueue = submissions
      .filter((submission) => submission.status !== "draft")
      .map((submission) => {
        const nextStatus: DecisionQueueItem["status"] =
          submission.status === "decision-made" ? "decision-made" : "submitted";

        return {
          applicantName: submission.applicantName,
          averageScore: submission.averageScore,
          budgetTotal: submission.budgetTotal,
          finalDecision: submission.finalDecision,
          pendingReviews: submission.pendingReviews,
          recommendationSpread: submission.recommendationSpread,
          reviewCount: submission.reviewCount,
          status: nextStatus,
          submissionId: submission.id,
          submittedAt: submission.submittedAt,
          title: submission.title,
        };
      })
      .sort((left, right) => {
        if (left.finalDecision === null && right.finalDecision !== null) {
          return -1;
        }
        if (left.finalDecision !== null && right.finalDecision === null) {
          return 1;
        }
        return (right.averageScore ?? 0) - (left.averageScore ?? 0);
      });

    const loads = reviewerLoads.map((item) => item.currentLoad);
    const loadGap = loads.length > 0 ? Math.max(...loads) - Math.min(...loads) : 0;
    const conflictFlags = assignments.filter((assignment) => Boolean(assignment.reviewConflictFlag)).length;

    return {
      balanceQueue,
      decisionQueue,
      insights: {
        conflictFlags,
        escalatedReviews: assignments.filter((assignment) => assignment.escalatedAt).length,
        loadGap,
        overdueReviews: overdueAlerts.length,
        pendingReviews: assignments.filter(
          (assignment) => this.deriveAssignmentStatus(assignment) !== "reviewed",
        ).length,
        submittedApplications: submissions.filter((submission) => submission.status !== "draft").length,
      },
      overdueAlerts,
      reviewerLoads,
      reviewerOptions,
    };
  }

  private buildReviewerView(
    user: SessionUser,
    submissions: SubmissionRecord[],
    assignments: AssignmentRow[],
  ): ReviewerView {
    const submissionsById = new Map(submissions.map((submission) => [submission.id, submission]));
    const reviewerAssignments = assignments
      .filter((assignment) => assignment.reviewerId === user.id)
      .map((assignment) => {
        const submission = submissionsById.get(assignment.submissionId);
        if (!submission) {
          throw new Error(`Missing submission ${assignment.submissionId}`);
        }

        return {
          applicantName: submission.applicantName,
          applicantOrganization: submission.applicantOrganization,
          assignmentId: assignment.assignmentId,
          budgetLines: submission.budgetLines,
          budgetTotal: submission.budgetTotal,
          dueAt: assignment.dueAt,
          escalatedAt: assignment.escalatedAt,
          existingReview: this.mapReviewState(assignment),
          milestones: submission.milestones,
          status: this.deriveAssignmentStatus(assignment),
          submissionId: submission.id,
          summary: submission.summary,
          tags: submission.tags,
          title: submission.title,
        } satisfies ReviewAssignment;
      })
      .sort((left, right) => {
        const leftWeight = left.status === "overdue" ? 0 : left.status === "pending" ? 1 : 2;
        const rightWeight = right.status === "overdue" ? 0 : right.status === "pending" ? 1 : 2;
        if (leftWeight !== rightWeight) {
          return leftWeight - rightWeight;
        }
        return left.dueAt.localeCompare(right.dueAt);
      });

    return {
      assignments: reviewerAssignments,
    };
  }

  private calculateWeightedScore(scores: Record<string, number>): number {
    const total = RUBRIC.reduce((sum, criterion) => {
      const rawScore = scores[criterion.key] ?? 1;
      return sum + (rawScore / 5) * criterion.weight;
    }, 0);

    return this.round(total);
  }

  private deriveAssignmentStatus(assignment: AssignmentRow): "overdue" | "pending" | "reviewed" {
    if (assignment.reviewRecommendation) {
      return "reviewed";
    }

    if (new Date(assignment.dueAt).getTime() < Date.now()) {
      return "overdue";
    }

    return "pending";
  }

  private ensureInitialAssignments(submissionId: number): void {
    const existing = this.queryAll<{ reviewerId: number }>(
      "SELECT reviewer_id AS reviewerId FROM assignments WHERE submission_id = ?",
      [submissionId],
    );
    if (existing.length > 0) {
      return;
    }

    const reviewers = this.queryAll<UserRow>(
      `
        SELECT id, email, name, role, organization
        FROM users
        WHERE role = 'reviewer'
        ORDER BY name ASC
      `,
    );
    if (reviewers.length === 0) {
      return;
    }

    const assignments = this.getAssignmentRows();
    const loadMap = new Map<number, number>();
    for (const reviewer of reviewers) {
      loadMap.set(
        reviewer.id,
        assignments.filter(
          (assignment) =>
            assignment.reviewerId === reviewer.id && this.deriveAssignmentStatus(assignment) !== "reviewed",
        ).length,
      );
    }

    const selected = reviewers
      .slice()
      .sort((left, right) => {
        const leftLoad = loadMap.get(left.id) ?? 0;
        const rightLoad = loadMap.get(right.id) ?? 0;
        if (leftLoad !== rightLoad) {
          return leftLoad - rightLoad;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, Math.min(2, reviewers.length));

    const assignedBy = this.getDefaultCoordinatorId();
    const now = new Date();
    const statement = this.db.prepare(
      `
        INSERT INTO assignments (
          submission_id,
          reviewer_id,
          assigned_by,
          due_at,
          status,
          escalated_at,
          escalation_note,
          assigned_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, '', ?)
      `,
    );

    selected.forEach((reviewer, index) => {
      const dueAt = new Date(now.getTime() + (48 + index * 12) * 60 * 60 * 1000).toISOString();
      statement.run([submissionId, reviewer.id, assignedBy, dueAt, this.now()]);
    });
    statement.free();
  }

  private getAssignmentRows(): AssignmentRow[] {
    return this.queryAll<AssignmentRow>(
      `
        SELECT
          a.id AS assignmentId,
          a.submission_id AS submissionId,
          a.reviewer_id AS reviewerId,
          a.assigned_at AS assignedAt,
          a.due_at AS dueAt,
          a.escalated_at AS escalatedAt,
          a.status,
          u.name AS reviewerName,
          u.organization AS reviewerOrganization,
          r.recommendation AS reviewRecommendation,
          r.conflict_flag AS reviewConflictFlag,
          r.rubric_json AS rubricJson,
          r.weighted_score AS scoreValue,
          r.notes AS reviewNotes,
          r.submitted_at AS reviewSubmittedAt,
          r.updated_at AS reviewUpdatedAt
        FROM assignments a
        INNER JOIN users u ON u.id = a.reviewer_id
        LEFT JOIN reviews r ON r.assignment_id = a.id
        ORDER BY datetime(a.due_at) ASC, a.id ASC
      `,
    ).map((row) => ({
      ...row,
      assignmentId: Number(row.assignmentId),
      reviewerId: Number(row.reviewerId),
      scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
      submissionId: Number(row.submissionId),
    }));
  }

  private getDefaultCoordinatorId(): number {
    const row = this.queryOne<{ id: number }>(
      "SELECT id FROM users WHERE role = 'coordinator' ORDER BY id ASC LIMIT 1",
    );
    if (!row) {
      throw new Error("Coordinator account not found.");
    }
    return Number(row.id);
  }

  private getRecentActivity(limit: number): ActivityItem[] {
    return this.queryAll<ActivityItem>(
      `
        SELECT id, actor_name AS actorName, actor_role AS actorRole, action_type AS actionType,
               entity_type AS entityType, message, created_at AS createdAt
        FROM activity_log
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `,
      [limit],
    ).map((row) => ({
      ...row,
      id: Number(row.id),
    }));
  }

  private getSubmissionRecords(): SubmissionRecord[] {
    const submissions = this.queryAll<SubmissionRow>(
      `
        SELECT
          s.id,
          s.applicant_id AS applicantId,
          u.name AS applicantName,
          s.organization AS applicantOrganization,
          s.title,
          s.summary,
          s.budget_total AS budgetTotal,
          s.budget_lines_json AS budgetLinesJson,
          s.milestones_json AS milestonesJson,
          s.tags_json AS tagsJson,
          s.status,
          s.submitted_at AS submittedAt,
          s.updated_at AS updatedAt,
          s.final_decision AS finalDecision
        FROM submissions s
        INNER JOIN users u ON u.id = s.applicant_id
        ORDER BY datetime(COALESCE(s.submitted_at, s.updated_at)) DESC, s.id DESC
      `,
    );

    const assignments = this.getAssignmentRows();

    return submissions.map((row) => {
      const linkedAssignments = assignments.filter((assignment) => assignment.submissionId === Number(row.id));
      const reviewedAssignments = linkedAssignments.filter((assignment) => assignment.reviewRecommendation);
      const recommendationSpread: RecommendationSpread = {
        decline: 0,
        fund: 0,
        revise: 0,
      };

      for (const assignment of reviewedAssignments) {
        if (assignment.reviewRecommendation) {
          recommendationSpread[assignment.reviewRecommendation] += 1;
        }
      }

      const scoreTotal = reviewedAssignments.reduce((sum, assignment) => sum + (assignment.scoreValue ?? 0), 0);

      return {
        applicantName: String(row.applicantName),
        applicantOrganization: String(row.applicantOrganization),
        averageScore: reviewedAssignments.length ? this.round(scoreTotal / reviewedAssignments.length) : null,
        budgetLines: this.parseJson<BudgetLine>(row.budgetLinesJson),
        budgetTotal: Number(row.budgetTotal),
        finalDecision: row.finalDecision ?? null,
        id: Number(row.id),
        milestones: this.parseJson<Milestone>(row.milestonesJson),
        pendingReviews: linkedAssignments.length - reviewedAssignments.length,
        recommendationSpread,
        reviewCount: reviewedAssignments.length,
        status: row.status,
        submittedAt: row.submittedAt,
        summary: String(row.summary),
        tags: this.parseJson<string>(row.tagsJson),
        title: String(row.title),
        updatedAt: String(row.updatedAt),
      };
    });
  }

  private getUserById(userId: number): SessionUser | null {
    const row = this.queryOne<UserRow>(
      "SELECT id, email, name, role, organization FROM users WHERE id = ?",
      [userId],
    );
    return row ? this.mapUser(row) : null;
  }

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private insertActivity(
    actorUserId: number | null,
    actionType: string,
    entityType: string,
    entityId: number | null,
    message: string,
    persistImmediately: boolean,
  ): void {
    const actor = actorUserId ? this.getUserById(actorUserId) : null;
    const statement = this.db.prepare(
      `
        INSERT INTO activity_log (
          actor_user_id,
          actor_name,
          actor_role,
          action_type,
          entity_type,
          entity_id,
          message,
          meta_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
      `,
    );
    statement.run([
      actorUserId,
      actor?.name ?? "GrantLane Automations",
      actor?.role ?? "coordinator",
      actionType,
      entityType,
      entityId,
      message,
      this.now(),
    ]);
    statement.free();

    if (persistImmediately) {
      this.persist();
    }
  }

  private mapReviewState(assignment: AssignmentRow): ReviewState | null {
    if (!assignment.reviewRecommendation || !assignment.rubricJson || assignment.scoreValue === null) {
      return null;
    }

    return {
      conflictFlag: Boolean(assignment.reviewConflictFlag),
      notes: assignment.reviewNotes ?? "",
      recommendation: assignment.reviewRecommendation,
      scores: this.parseJsonObject<Record<string, number>>(assignment.rubricJson),
      submittedAt: assignment.reviewSubmittedAt ?? assignment.assignedAt,
      updatedAt: assignment.reviewUpdatedAt ?? assignment.assignedAt,
      weightedScore: Number(assignment.scoreValue),
    };
  }

  private mapUser(row: UserRow): SessionUser {
    return {
      email: String(row.email),
      id: Number(row.id),
      name: String(row.name),
      organization: String(row.organization),
      role: row.role,
    };
  }

  private migrate(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        organization TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        organization TEXT NOT NULL,
        summary TEXT NOT NULL,
        budget_total REAL NOT NULL,
        budget_lines_json TEXT NOT NULL,
        milestones_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        status TEXT NOT NULL,
        submitted_at TEXT,
        updated_at TEXT NOT NULL,
        final_decision TEXT,
        FOREIGN KEY(applicant_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        reviewer_id INTEGER NOT NULL,
        assigned_by INTEGER NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL,
        escalated_at TEXT,
        escalation_note TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        FOREIGN KEY(submission_id) REFERENCES submissions(id),
        FOREIGN KEY(reviewer_id) REFERENCES users(id),
        FOREIGN KEY(assigned_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL UNIQUE,
        reviewer_id INTEGER NOT NULL,
        recommendation TEXT NOT NULL,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        rubric_json TEXT NOT NULL,
        weighted_score REAL NOT NULL,
        notes TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(assignment_id) REFERENCES assignments(id),
        FOREIGN KEY(reviewer_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        message TEXT NOT NULL,
        meta_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(actor_user_id) REFERENCES users(id)
      );
    `);
  }

  private normalizeRubricScores(scores: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {};

    for (const criterion of RUBRIC) {
      const raw = Number(scores[criterion.key]);
      normalized[criterion.key] = Math.min(5, Math.max(1, Number.isFinite(raw) ? Math.round(raw) : 3));
    }

    return normalized;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private parseJson<T>(value: string | null): T[] {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as T[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private parseJsonObject<T extends Record<string, unknown>>(value: string | null): T {
    if (!value) {
      return {} as T;
    }

    try {
      const parsed = JSON.parse(value) as T;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : ({} as T);
    } catch {
      return {} as T;
    }
  }

  private persist(): void {
    const buffer = Buffer.from(this.db.export());
    fs.writeFileSync(this.filePath, buffer);
  }

  private queryAll<T>(sql: string, params: SqlParam[] = []): T[] {
    const statement = this.db.prepare(sql);
    statement.bind(params);
    const rows: T[] = [];

    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }

    statement.free();
    return rows;
  }

  private queryOne<T>(sql: string, params: SqlParam[] = []): T | null {
    const statement = this.db.prepare(sql);
    statement.bind(params);

    if (!statement.step()) {
      statement.free();
      return null;
    }

    const row = statement.getAsObject() as T;
    statement.free();
    return row;
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private sanitizeBudgetLines(lines: BudgetLine[]): BudgetLine[] {
    return lines
      .map((line) => ({
        amount: Number.isFinite(Number(line.amount)) ? Number(line.amount) : 0,
        label: String(line.label ?? "").trim(),
      }))
      .filter((line) => line.label.length > 0 || line.amount > 0);
  }

  private sanitizeMilestones(milestones: Milestone[]): Milestone[] {
    return milestones
      .map((milestone) => ({
        dueDate: String(milestone.dueDate ?? "").trim(),
        note: String(milestone.note ?? "").trim(),
        title: String(milestone.title ?? "").trim(),
      }))
      .filter((milestone) => milestone.title.length > 0 || milestone.dueDate.length > 0);
  }

  private sanitizeTags(tags: string[]): string[] {
    return tags
      .map((tag) => String(tag ?? "").trim().toLowerCase())
      .filter((tag, index, values) => tag.length > 0 && values.indexOf(tag) === index)
      .slice(0, 8);
  }

  private seedIfNeeded(): void {
    const countResult = this.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    const userCount = Number(countResult?.count ?? 0);

    if (userCount > 0) {
      return;
    }

    const now = new Date();
    const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

    const userStatement = this.db.prepare(
      `
        INSERT INTO users (email, name, role, organization, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    );

    const seededUsers = [
      ["obrera@grantlane.local", "Ana Obrera", "coordinator", "GrantLane Operations", this.hash("nightshift063"), hoursFromNow(-96)],
      ["applicant@grantlane.local", "Mina Sol", "applicant", "North Canal Lab", this.hash("nightshift063"), hoursFromNow(-120)],
      ["studio@grantlane.local", "Iris Vale", "applicant", "South Dock Studio", this.hash("nightshift063"), hoursFromNow(-112)],
      ["reviewer.one@grantlane.local", "Jon Park", "reviewer", "Civic Futures Review", this.hash("nightshift063"), hoursFromNow(-140)],
      ["reviewer.two@grantlane.local", "Tessa Bloom", "reviewer", "Public Arts Ledger", this.hash("nightshift063"), hoursFromNow(-141)],
      ["reviewer.three@grantlane.local", "Malik Shore", "reviewer", "Regional Grants Desk", this.hash("nightshift063"), hoursFromNow(-142)],
    ];

    for (const user of seededUsers) {
      userStatement.run(user);
    }
    userStatement.free();

    const userIds = new Map<string, number>(
      this.queryAll<{ email: string; id: number }>("SELECT email, id FROM users").map((row) => [
        String(row.email),
        Number(row.id),
      ]),
    );
    const applicantId = this.requiredId(userIds, "applicant@grantlane.local");
    const studioId = this.requiredId(userIds, "studio@grantlane.local");

    const submissionStatement = this.db.prepare(
      `
        INSERT INTO submissions (
          applicant_id,
          title,
          organization,
          summary,
          budget_total,
          budget_lines_json,
          milestones_json,
          tags_json,
          status,
          submitted_at,
          updated_at,
          final_decision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    submissionStatement.run([
      applicantId,
      "Riverside Oral History Atlas",
      "North Canal Lab",
      "A draft proposal to capture late-shift oral histories, annotate them, and publish a neighborhood listening archive.",
      62000,
      JSON.stringify([
        { label: "Field recording stipends", amount: 24000 },
        { label: "Archive editing", amount: 16000 },
        { label: "Community listening events", amount: 22000 },
      ] satisfies BudgetLine[]),
      JSON.stringify([
        { title: "Interview 40 night workers", dueDate: hoursFromNow(240), note: "Recruit from bus, hospital, and warehouse shifts." },
        { title: "Edit bilingual archive", dueDate: hoursFromNow(520), note: "Publish searchable transcripts and audio excerpts." },
      ] satisfies Milestone[]),
      JSON.stringify(["archives", "oral-history", "public-memory"]),
      "draft",
      null,
      hoursFromNow(-4),
      null,
    ]);

    submissionStatement.run([
      applicantId,
      "Night Transit Care Pods",
      "North Canal Lab",
      "Mobile care pods stationed at late bus depots to offer warming space, charging, and basic navigation support for riders and operators.",
      145000,
      JSON.stringify([
        { label: "Pod fabrication", amount: 68000 },
        { label: "Transit host stipends", amount: 42000 },
        { label: "Safety and insurance", amount: 35000 },
      ] satisfies BudgetLine[]),
      JSON.stringify([
        { title: "Fabricate two pod units", dueDate: hoursFromNow(360), note: "Weatherproof and power-ready." },
        { title: "Launch depot pilot", dueDate: hoursFromNow(720), note: "Run six-week evening pilot with ridership interviews." },
      ] satisfies Milestone[]),
      JSON.stringify(["mobility", "care-infrastructure", "late-night"]),
      "submitted",
      hoursFromNow(-72),
      hoursFromNow(-72),
      null,
    ]);

    submissionStatement.run([
      studioId,
      "Civic Weather Commons",
      "South Dock Studio",
      "A neighborhood weather reading room pairing local sensor boards with story sessions and public climate adaptation briefings.",
      98000,
      JSON.stringify([
        { label: "Sensor network", amount: 38000 },
        { label: "Story commissions", amount: 26000 },
        { label: "Reading room build-out", amount: 34000 },
      ] satisfies BudgetLine[]),
      JSON.stringify([
        { title: "Install six neighborhood sensors", dueDate: hoursFromNow(300), note: "Partner with block associations." },
        { title: "Open monthly commons sessions", dueDate: hoursFromNow(660), note: "Publish adaptation notes after each session." },
      ] satisfies Milestone[]),
      JSON.stringify(["climate", "public-learning", "civic-data"]),
      "submitted",
      hoursFromNow(-58),
      hoursFromNow(-58),
      null,
    ]);

    submissionStatement.run([
      studioId,
      "South Side Apprenticeship Studio",
      "South Dock Studio",
      "A paid apprenticeship studio connecting emerging fabricators with neighborhood commissions, bookkeeping support, and public exhibitions.",
      124000,
      JSON.stringify([
        { label: "Apprentice wages", amount: 70000 },
        { label: "Fabrication materials", amount: 30000 },
        { label: "Exhibition and bookkeeping", amount: 24000 },
      ] satisfies BudgetLine[]),
      JSON.stringify([
        { title: "Recruit first apprentice cohort", dueDate: hoursFromNow(280), note: "Eight apprentices for a twelve-week cycle." },
        { title: "Deliver community commissions", dueDate: hoursFromNow(760), note: "Complete storefront seating, signage, and wayfinding set." },
      ] satisfies Milestone[]),
      JSON.stringify(["workforce", "fabrication", "small-business"]),
      "submitted",
      hoursFromNow(-36),
      hoursFromNow(-36),
      null,
    ]);
    submissionStatement.free();

    const submissionIds = new Map<string, number>(
      this.queryAll<{ id: number; title: string }>("SELECT id, title FROM submissions").map((row) => [
        String(row.title),
        Number(row.id),
      ]),
    );

    const assignmentStatement = this.db.prepare(
      `
        INSERT INTO assignments (
          submission_id,
          reviewer_id,
          assigned_by,
          due_at,
          status,
          escalated_at,
          escalation_note,
          assigned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const coordinatorId = this.requiredId(userIds, "obrera@grantlane.local");
    const reviewerOneId = this.requiredId(userIds, "reviewer.one@grantlane.local");
    const reviewerTwoId = this.requiredId(userIds, "reviewer.two@grantlane.local");
    const reviewerThreeId = this.requiredId(userIds, "reviewer.three@grantlane.local");
    const podsId = this.requiredId(submissionIds, "Night Transit Care Pods");
    const weatherId = this.requiredId(submissionIds, "Civic Weather Commons");
    const apprenticeshipId = this.requiredId(submissionIds, "South Side Apprenticeship Studio");

    assignmentStatement.run([
      podsId,
      reviewerOneId,
      coordinatorId,
      hoursFromNow(-22),
      "pending",
      hoursFromNow(-6),
      "Deadline escalation after missed reviewer checkpoint.",
      hoursFromNow(-70),
    ]);
    assignmentStatement.run([
      podsId,
      reviewerTwoId,
      coordinatorId,
      hoursFromNow(-8),
      "reviewed",
      null,
      "",
      hoursFromNow(-70),
    ]);
    assignmentStatement.run([
      weatherId,
      reviewerOneId,
      coordinatorId,
      hoursFromNow(8),
      "pending",
      null,
      "",
      hoursFromNow(-52),
    ]);
    assignmentStatement.run([
      weatherId,
      reviewerThreeId,
      coordinatorId,
      hoursFromNow(-2),
      "reviewed",
      null,
      "",
      hoursFromNow(-52),
    ]);
    assignmentStatement.run([
      apprenticeshipId,
      reviewerOneId,
      coordinatorId,
      hoursFromNow(28),
      "pending",
      null,
      "",
      hoursFromNow(-30),
    ]);
    assignmentStatement.run([
      apprenticeshipId,
      reviewerThreeId,
      coordinatorId,
      hoursFromNow(-5),
      "reviewed",
      null,
      "",
      hoursFromNow(-30),
    ]);
    assignmentStatement.free();

    const reviewStatement = this.db.prepare(
      `
        INSERT INTO reviews (
          assignment_id,
          reviewer_id,
          recommendation,
          conflict_flag,
          rubric_json,
          weighted_score,
          notes,
          submitted_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    reviewStatement.run([
      2,
      reviewerTwoId,
      "fund",
      0,
      JSON.stringify({
        equity: 4,
        execution: 4,
        publicValue: 5,
        stewardship: 4,
      }),
      88,
      "Operational detail is strong. Transit partnership language is already procurement-aware.",
      hoursFromNow(-10),
      hoursFromNow(-10),
    ]);
    reviewStatement.run([
      4,
      reviewerThreeId,
      "revise",
      0,
      JSON.stringify({
        equity: 4,
        execution: 3,
        publicValue: 4,
        stewardship: 3,
      }),
      72,
      "Strong civic framing, but the sensor maintenance plan needs harder staffing math.",
      hoursFromNow(-3),
      hoursFromNow(-3),
    ]);
    reviewStatement.run([
      6,
      reviewerThreeId,
      "decline",
      1,
      JSON.stringify({
        equity: 3,
        execution: 3,
        publicValue: 4,
        stewardship: 2,
      }),
      61,
      "Conflict flagged because our office advised the applicant on a prior fabrication pilot.",
      hoursFromNow(-4),
      hoursFromNow(-4),
    ]);
    reviewStatement.free();

    const activities = [
      [coordinatorId, "open-round", "program", null, "Ana Obrera opened GrantLane build 063 for the current review round.", hoursFromNow(-84)],
      [applicantId, "save-draft", "submission", this.requiredId(submissionIds, "Riverside Oral History Atlas"), "Mina Sol saved a draft for Riverside Oral History Atlas.", hoursFromNow(-4)],
      [applicantId, "submit-application", "submission", podsId, "Mina Sol submitted Night Transit Care Pods for review.", hoursFromNow(-72)],
      [studioId, "submit-application", "submission", weatherId, "Iris Vale submitted Civic Weather Commons for review.", hoursFromNow(-58)],
      [studioId, "submit-application", "submission", apprenticeshipId, "Iris Vale submitted South Side Apprenticeship Studio for review.", hoursFromNow(-36)],
      [coordinatorId, "rebalance", "assignment", 3, "Ana Obrera rebalanced Civic Weather Commons toward a lighter reviewer queue.", hoursFromNow(-32)],
      [reviewerTwoId, "submit-review", "assignment", 2, "Tessa Bloom submitted a fund recommendation for Night Transit Care Pods.", hoursFromNow(-10)],
      [coordinatorId, "escalate-deadline", "assignment", 1, "Ana Obrera escalated Jon Park's review deadline for Night Transit Care Pods.", hoursFromNow(-6)],
      [reviewerThreeId, "submit-review", "assignment", 4, "Malik Shore submitted a revise recommendation for Civic Weather Commons.", hoursFromNow(-3)],
      [reviewerThreeId, "submit-review", "assignment", 6, "Malik Shore submitted a decline recommendation for South Side Apprenticeship Studio and flagged a conflict of interest.", hoursFromNow(-2)],
    ] as const;

    const activityStatement = this.db.prepare(
      `
        INSERT INTO activity_log (
          actor_user_id,
          actor_name,
          actor_role,
          action_type,
          entity_type,
          entity_id,
          message,
          meta_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
      `,
    );

    for (const [actorUserId, actionType, entityType, entityId, message, createdAt] of activities) {
      const actor = actorUserId ? this.getUserById(actorUserId) : null;
      activityStatement.run([
        actorUserId ?? null,
        actor?.name ?? "GrantLane Automations",
        actor?.role ?? "coordinator",
        actionType,
        entityType,
        entityId ?? null,
        message,
        createdAt,
      ]);
    }
    activityStatement.free();
  }

  private sortByRecent(left: string, right: string): number {
    return new Date(left).getTime() - new Date(right).getTime();
  }

  private requiredId(values: Map<string, number>, key: string): number {
    const value = values.get(key);
    if (typeof value !== "number") {
      throw new Error(`Missing seeded id for ${key}`);
    }
    return value;
  }
}
