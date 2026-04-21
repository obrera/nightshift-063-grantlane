import cookieParser from "cookie-parser";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import {
  AppDb,
  BudgetLine,
  FinalDecision,
  Milestone,
  ReviewerRecommendation,
  SessionUser,
  UserRole,
} from "./db";

type AuthedRequest = Request & {
  user?: SessionUser;
};

const SESSION_COOKIE = "grantlane-session";

async function main(): Promise<void> {
  const db = await AppDb.create();
  const app = express();
  const port = Number(process.env.PORT ?? 3000);
  const publicDir = path.join(process.cwd(), "dist", "public");

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use((request: AuthedRequest, _response, next) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      request.user = db.getUserBySession(token) ?? undefined;
    }
    next();
  });

  const requireAuth = (request: AuthedRequest, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };

  const requireRole =
    (...roles: UserRole[]) =>
    (request: AuthedRequest, response: Response, next: NextFunction) => {
      if (!request.user) {
        response.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!roles.includes(request.user.role)) {
        response.status(403).json({ error: "Forbidden" });
        return;
      }

      next();
    };

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "grantlane" });
  });

  app.post("/api/register", (request, response) => {
    try {
      const user = db.registerApplicant({
        email: String(request.body?.email ?? ""),
        name: String(request.body?.name ?? ""),
        organization: String(request.body?.organization ?? ""),
        password: String(request.body?.password ?? ""),
      });

      const token = db.createSession(user.id);
      response.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8,
        sameSite: "lax",
      });
      response.status(201).json({ user });
    } catch (error) {
      respondWithError(response, error, 400);
    }
  });

  app.post("/api/login", (request, response) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    const password = String(request.body?.password ?? "");
    const user = db.login(email, password);

    if (!user) {
      response.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = db.createSession(user.id);
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: "lax",
    });
    response.json({ user });
  });

  app.post("/api/logout", requireAuth, (request, response) => {
    const token = String(request.cookies?.[SESSION_COOKIE] ?? "");
    if (token) {
      db.deleteSession(token);
    }
    response.clearCookie(SESSION_COOKIE);
    response.status(204).send();
  });

  app.get("/api/session", (request: AuthedRequest, response) => {
    response.json({ user: request.user ?? null });
  });

  app.get("/api/dashboard", requireAuth, (request: AuthedRequest, response) => {
    response.json(db.getDashboard(request.user!.id));
  });

  app.post("/api/submissions", requireRole("applicant"), (request: AuthedRequest, response) => {
    try {
      db.saveSubmission(request.user!.id, {
        action: request.body?.action === "submit" ? "submit" : "draft",
        budgetLines: parseBudgetLines(request.body?.budgetLines),
        budgetTotal: Number(request.body?.budgetTotal ?? 0),
        id: toOptionalNumber(request.body?.id),
        milestones: parseMilestones(request.body?.milestones),
        organization: String(request.body?.organization ?? ""),
        summary: String(request.body?.summary ?? ""),
        tags: Array.isArray(request.body?.tags) ? request.body.tags.map(String) : [],
        title: String(request.body?.title ?? ""),
      });
      response.status(201).json(db.getDashboard(request.user!.id));
    } catch (error) {
      respondWithError(response, error, 400);
    }
  });

  app.post(
    "/api/assignments/:assignmentId/review",
    requireRole("reviewer"),
    (request: AuthedRequest, response) => {
      const assignmentId = Number(request.params.assignmentId);
      if (!Number.isFinite(assignmentId)) {
        response.status(400).json({ error: "Invalid assignment id" });
        return;
      }

      try {
        db.saveReview(request.user!.id, assignmentId, {
          conflictFlag: Boolean(request.body?.conflictFlag),
          notes: String(request.body?.notes ?? ""),
          recommendation: String(request.body?.recommendation ?? "revise") as ReviewerRecommendation,
          scores:
            request.body?.scores && typeof request.body.scores === "object"
              ? (request.body.scores as Record<string, number>)
              : {},
        });
        response.json(db.getDashboard(request.user!.id));
      } catch (error) {
        respondWithError(response, error, 400);
      }
    },
  );

  app.post(
    "/api/assignments/:assignmentId/reassign",
    requireRole("coordinator"),
    (request: AuthedRequest, response) => {
      const assignmentId = Number(request.params.assignmentId);
      const reviewerId = Number(request.body?.reviewerId);

      if (!Number.isFinite(assignmentId) || !Number.isFinite(reviewerId)) {
        response.status(400).json({ error: "Invalid rebalance request" });
        return;
      }

      try {
        db.reassignAssignment(request.user!.id, assignmentId, reviewerId);
        response.json(db.getDashboard(request.user!.id));
      } catch (error) {
        respondWithError(response, error, 400);
      }
    },
  );

  app.post(
    "/api/assignments/:assignmentId/escalate",
    requireRole("coordinator"),
    (request: AuthedRequest, response) => {
      const assignmentId = Number(request.params.assignmentId);
      if (!Number.isFinite(assignmentId)) {
        response.status(400).json({ error: "Invalid escalation request" });
        return;
      }

      try {
        db.escalateAssignment(
          request.user!.id,
          assignmentId,
          String(request.body?.note ?? "Coordinator escalation requested."),
        );
        response.json(db.getDashboard(request.user!.id));
      } catch (error) {
        respondWithError(response, error, 400);
      }
    },
  );

  app.post(
    "/api/submissions/:submissionId/decision",
    requireRole("coordinator"),
    (request: AuthedRequest, response) => {
      const submissionId = Number(request.params.submissionId);
      if (!Number.isFinite(submissionId)) {
        response.status(400).json({ error: "Invalid submission id" });
        return;
      }

      try {
        db.setFinalDecision(
          request.user!.id,
          submissionId,
          String(request.body?.decision ?? "hold") as FinalDecision,
          String(request.body?.note ?? ""),
        );
        response.json(db.getDashboard(request.user!.id));
      } catch (error) {
        respondWithError(response, error, 400);
      }
    },
  );

  app.use(express.static(publicDir));
  app.get(/^(?!\/api|\/health).*/, (_request, response) => {
    response.sendFile(path.join(publicDir, "index.html"));
  });

  app.listen(port, () => {
    console.log(`GrantLane listening on http://localhost:${port}`);
  });
}

function parseBudgetLines(input: unknown): BudgetLine[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((line) => ({
    amount: Number((line as { amount?: number }).amount ?? 0),
    label: String((line as { label?: string }).label ?? ""),
  }));
}

function parseMilestones(input: unknown): Milestone[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((milestone) => ({
    dueDate: String((milestone as { dueDate?: string }).dueDate ?? ""),
    note: String((milestone as { note?: string }).note ?? ""),
    title: String((milestone as { title?: string }).title ?? ""),
  }));
}

function respondWithError(response: Response, error: unknown, fallbackStatus: number): void {
  response.status(fallbackStatus).json({
    error: error instanceof Error ? error.message : "Request failed",
  });
}

function toOptionalNumber(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
