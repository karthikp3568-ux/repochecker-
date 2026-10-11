-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('draft', 'rubric_ready', 'running', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'judge', 'viewer');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('github', 'git', 'zip');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'FETCHING', 'INDEXING', 'EXECUTING', 'GRADING', 'VERIFYING', 'SCORING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunEventType" AS ENUM ('stage', 'tool', 'note', 'warning', 'error');

-- CreateEnum
CREATE TYPE "FileAccessKind" AS ENUM ('read', 'search');

-- CreateEnum
CREATE TYPE "CriterionScoreStatus" AS ENUM ('scored', 'insufficient_evidence', 'gate_pass', 'gate_fail');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('strength', 'issue');

-- CreateEnum
CREATE TYPE "EvidenceSeverity" AS ENUM ('critical', 'major', 'minor');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "FlagSource" AS ENUM ('agent', 'scanner');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'needs_review', 'approved', 'disqualified');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "GithubConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'draft',
    "activeRubricVersionId" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationMember" (
    "evaluationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,

    CONSTRAINT "EvaluationMember_pkey" PRIMARY KEY ("evaluationId","userId")
);

-- CreateTable
CREATE TABLE "RubricDraft" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "questions" JSONB,
    "answers" JSONB,
    "rubric" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RubricDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricVersion" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    "clarifications" JSONB NOT NULL,
    "rubric" JSONB NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedById" TEXT NOT NULL,

    CONSTRAINT "RubricVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rubric" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "teamName" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "repoUrl" TEXT,
    "branch" TEXT,
    "commitSha" TEXT NOT NULL,
    "zipKey" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoSnapshot" (
    "id" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "statusReason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "consensusIndex" INTEGER NOT NULL DEFAULT 0,
    "depth" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cacheRead" INTEGER NOT NULL DEFAULT 0,
    "cacheWrite" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "RunEventType" NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "exitCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "stdoutTail" TEXT NOT NULL,
    "stderrTail" TEXT NOT NULL,

    CONSTRAINT "ExecutionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAccess" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "kind" "FileAccessKind" NOT NULL,

    CONSTRAINT "FileAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionScore" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "status" "CriterionScoreStatus" NOT NULL,
    "score" DOUBLE PRECISION,
    "confidence" "Confidence" NOT NULL,
    "rationale" TEXT NOT NULL,
    "improvement" TEXT NOT NULL,
    "verifier" JSONB,

    CONSTRAINT "CriterionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "criterionScoreId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "severity" "EvidenceSeverity",
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyReason" TEXT,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityFlag" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "category" TEXT NOT NULL,
    "path" TEXT,
    "line" INTEGER,
    "description" TEXT NOT NULL,
    "source" "FlagSource" NOT NULL,

    CONSTRAINT "IntegrityFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rubricVersionId" TEXT NOT NULL,
    "runIds" TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "aiOverall" DOUBLE PRECISION,
    "finalOverall" DOUBLE PRECISION,
    "percent" DOUBLE PRECISION,
    "letter" TEXT,
    "summary" TEXT NOT NULL,
    "recommendations" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "shareToken" TEXT,
    "shareOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreOverride" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "aiScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanScore" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "criterionId" TEXT,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "GithubConnection_userId_idx" ON "GithubConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_activeRubricVersionId_key" ON "Evaluation"("activeRubricVersionId");

-- CreateIndex
CREATE INDEX "Evaluation_ownerId_idx" ON "Evaluation"("ownerId");

-- CreateIndex
CREATE INDEX "EvaluationMember_userId_idx" ON "EvaluationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RubricDraft_evaluationId_key" ON "RubricDraft"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "RubricVersion_evaluationId_version_key" ON "RubricVersion"("evaluationId", "version");

-- CreateIndex
CREATE INDEX "RubricTemplate_ownerId_idx" ON "RubricTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "Submission_evaluationId_idx" ON "Submission"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoSnapshot_sourceKey_commitSha_key" ON "RepoSnapshot"("sourceKey", "commitSha");

-- CreateIndex
CREATE INDEX "Run_submissionId_idx" ON "Run"("submissionId");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE INDEX "RunEvent_runId_ts_idx" ON "RunEvent"("runId", "ts");

-- CreateIndex
CREATE INDEX "ExecutionResult_runId_idx" ON "ExecutionResult"("runId");

-- CreateIndex
CREATE INDEX "FileAccess_runId_idx" ON "FileAccess"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionScore_runId_criterionId_key" ON "CriterionScore"("runId", "criterionId");

-- CreateIndex
CREATE INDEX "Evidence_criterionScoreId_idx" ON "Evidence"("criterionScoreId");

-- CreateIndex
CREATE INDEX "IntegrityFlag_runId_idx" ON "IntegrityFlag"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_shareToken_key" ON "Report"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Report_submissionId_rubricVersionId_key" ON "Report"("submissionId", "rubricVersionId");

-- CreateIndex
CREATE INDEX "ScoreOverride_reportId_idx" ON "ScoreOverride"("reportId");

-- CreateIndex
CREATE INDEX "HumanScore_reportId_idx" ON "HumanScore"("reportId");

-- CreateIndex
CREATE INDEX "Comment_reportId_idx" ON "Comment"("reportId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubConnection" ADD CONSTRAINT "GithubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_activeRubricVersionId_fkey" FOREIGN KEY ("activeRubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationMember" ADD CONSTRAINT "EvaluationMember_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationMember" ADD CONSTRAINT "EvaluationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricDraft" ADD CONSTRAINT "RubricDraft_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricTemplate" ADD CONSTRAINT "RubricTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepoSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionResult" ADD CONSTRAINT "ExecutionResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAccess" ADD CONSTRAINT "FileAccess_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionScore" ADD CONSTRAINT "CriterionScore_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_criterionScoreId_fkey" FOREIGN KEY ("criterionScoreId") REFERENCES "CriterionScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityFlag" ADD CONSTRAINT "IntegrityFlag_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_rubricVersionId_fkey" FOREIGN KEY ("rubricVersionId") REFERENCES "RubricVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanScore" ADD CONSTRAINT "HumanScore_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanScore" ADD CONSTRAINT "HumanScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
