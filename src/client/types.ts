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
