/*
  Warnings:

  - A unique constraint covering the columns `[nicNumber]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isFirstLogin" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nicNumber" TEXT,
ADD COLUMN     "otpCode" TEXT,
ADD COLUMN     "otpExpiry" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_nicNumber_key" ON "User"("nicNumber");
