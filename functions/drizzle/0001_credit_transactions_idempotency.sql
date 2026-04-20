CREATE UNIQUE INDEX "credit_transactions_idempotency_idx"
ON "credit_transactions" USING btree ("user_id", "reason", "reference_id")
WHERE "reference_id" IS NOT NULL;