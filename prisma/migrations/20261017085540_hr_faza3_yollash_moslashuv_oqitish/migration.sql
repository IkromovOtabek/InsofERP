-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('NEW', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'RESERVE');

-- CreateEnum
CREATE TYPE "InterviewResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NOSHOW');

-- CreateEnum
CREATE TYPE "ProbationStatus" AS ENUM ('ACTIVE', 'PASSED', 'EXTENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ASSIGNED', 'PASSED', 'FAILED');

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "requirements" TEXT,
    "salaryFrom" DECIMAL(18,2),
    "salaryTo" DECIMAL(18,2),
    "status" "VacancyStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "stage" "CandidateStage" NOT NULL DEFAULT 'NEW',
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER,
    "note" TEXT,
    "rejectReason" TEXT,
    "file" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "employeeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "place" TEXT,
    "interviewerId" TEXT,
    "result" "InterviewResult" NOT NULL DEFAULT 'PENDING',
    "feedback" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingPlan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mentorId" TEXT,
    "startDate" DATE NOT NULL,
    "probationEnd" DATE,
    "status" "ProbationStatus" NOT NULL DEFAULT 'ACTIVE',
    "result" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDay" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,

    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "material" TEXT,
    "contentUrl" TEXT,
    "position" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "questions" JSONB NOT NULL,
    "passScore" INTEGER NOT NULL DEFAULT 70,
    "validMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrollment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "dueDate" DATE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER,
    "lastAt" TIMESTAMP(3),
    "passedAt" TIMESTAMP(3),
    "certificateNo" TEXT,
    "expiresAt" DATE,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vacancy_status_idx" ON "Vacancy"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_employeeId_key" ON "Candidate"("employeeId");

-- CreateIndex
CREATE INDEX "Candidate_stage_idx" ON "Candidate"("stage");

-- CreateIndex
CREATE INDEX "Candidate_vacancyId_idx" ON "Candidate"("vacancyId");

-- CreateIndex
CREATE INDEX "Interview_at_idx" ON "Interview"("at");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingPlan_employeeId_key" ON "OnboardingPlan"("employeeId");

-- CreateIndex
CREATE INDEX "OnboardingPlan_status_probationEnd_idx" ON "OnboardingPlan"("status", "probationEnd");

-- CreateIndex
CREATE INDEX "OnboardingPlan_mentorId_idx" ON "OnboardingPlan"("mentorId");

-- CreateIndex
CREATE INDEX "OnboardingStep_planId_idx" ON "OnboardingStep"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_certificateNo_key" ON "CourseEnrollment"("certificateNo");

-- CreateIndex
CREATE INDEX "CourseEnrollment_employeeId_idx" ON "CourseEnrollment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_courseId_employeeId_key" ON "CourseEnrollment"("courseId", "employeeId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPlan" ADD CONSTRAINT "OnboardingPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OnboardingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

