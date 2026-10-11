-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "completedStage" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "result" JSONB;

-- CreateIndex
CREATE INDEX "Run_groupId_idx" ON "Run"("groupId");
