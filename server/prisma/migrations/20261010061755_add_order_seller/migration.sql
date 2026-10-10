/*
  Warnings:

  - Added the required column `sellerId` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `orders` ADD COLUMN `sellerId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE INDEX `orders_sellerId_status_idx` ON `orders`(`sellerId`, `status`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
