/*
  Warnings:

  - You are about to drop the column `engineNumber` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `Vehicle` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "engineNumber",
DROP COLUMN "phoneNumber";
