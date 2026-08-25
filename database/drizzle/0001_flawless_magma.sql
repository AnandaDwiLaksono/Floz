ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_provider_id_account_id_unique";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "issuer" varchar(255);--> statement-breakpoint
UPDATE "accounts" SET "issuer" = CASE WHEN "provider_id" = 'credential' THEN 'local:credential' WHEN "provider_id" = 'siwe' THEN 'local:siwe' WHEN "provider_id" = 'google' THEN 'https://accounts.google.com' ELSE 'local:oauth:' || replace(replace(replace(replace(replace("provider_id", '%', '%25'), '/', '%2F'), ':', '%3A'), ' ', '%20'), '@', '%40') END WHERE "issuer" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accounts" GROUP BY "issuer", "account_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'accounts issuer/account_id collision detected';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_issuer_account_id_unique" UNIQUE("issuer","account_id");
