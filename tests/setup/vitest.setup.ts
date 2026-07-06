import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Transitional compatibility while the remaining Jest-style tests are migrated.
(globalThis as typeof globalThis & { jest?: typeof vi }).jest = vi;

vi.mock("next/font/google", () => ({
  Inter: () => ({
    className: "font-inter",
    variable: "--font-inter",
  }),
}));

const requiredEnv: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: "https://example.test",
  NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
  SUPABASE_DB_URL: "postgresql://user:pass@localhost:5432/testdb",
  SHIPPO_API_TOKEN: "test-shippo-token",
  SHIPPO_WEBHOOK_TOKEN: "test-shippo-webhook-token",
  HERE_MAPS_API_KEY: "test-here-maps-api-key",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  SES_SMTP_HOST: "smtp.example.test",
  SES_SMTP_USER: "test-smtp-user",
  SES_SMTP_PASS: "test-smtp-pass",
  SES_FROM_EMAIL: "noreply@example.test",
  SES_FROM_NAME: "Test Sender",
  SUPPORT_INBOX_EMAIL: "support@example.test",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test-aws-access-key",
  AWS_SECRET_ACCESS_KEY: "test-aws-secret-key",
  ORDER_ACCESS_TOKEN_SECRET: "test-order-access-secret",
  NODE_ENV: "test",
};

for (const [key, value] of Object.entries(requiredEnv)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
