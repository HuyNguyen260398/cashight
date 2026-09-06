// Cashight — AWS architecture (static SPA + serverless microservices, ap-southeast-1).
// Type "pipeline". Layout engine only: NO hardcoded coordinates.
// NOTE: icon labels stay SHORT/single-line — draw.io collapses "\n" inside an icon label into one
// long overflowing line. Detail belongs in the frame headers or in a wrapping note box.
import { writeFileSync } from "node:fs";
import { Diagram } from "/opt/homebrew/lib/node_modules/drawio-ai-kit/src/builder.mjs";
import {
  group, frame, grid, icon, stage, band, endpoint, ossBox, onpremFrame, phantom, renderTree,
} from "/opt/homebrew/lib/node_modules/drawio-ai-kit/src/layout-engine.mjs";

const d = new Diagram("pipeline");

// ── entry point ───────────────────────────────────────────────────────────────
const users = endpoint("users", "USERS\n\nBrowser (SPA)\nsingle allowlisted\naccount");

// ── 1 · edge & frontend (global) ──────────────────────────────────────────────
const edge = stage("edge", 0, "1 · Edge & frontend (global) — cashight.nghuy.link · next.cashight.nghuy.link", [
  icon("r53", "route_53", "Route 53"),
  icon("acm", "certificate_manager_3", "ACM cert (us-east-1)"),
  icon("cf", "cloudfront", "CloudFront · SPA"),
  icon("cffn", "cloudfront_functions", "CF Fn spa-router"),
  icon("s3fe", "s3", "S3 frontend (private)"),
], { dir: "row" });

// ── 2 · authentication ────────────────────────────────────────────────────────
const auth = stage("auth", 1, "2 · Authentication", [
  icon("cog", "cognito", "Cognito User Pool"),
  icon("guard", "lambda", "auth-guard"),
  ossBox("n_auth", "Hosted UI + SPA client (Authorization Code + PKCE, no secret). auth-guard runs on pre_sign_up / pre_token_generation and enforces the single-email allowlist held in DynamoDB."),
], { gap: 36 });

// ── 3 · API layer ─────────────────────────────────────────────────────────────
const api = stage("api", 2, "3 · API layer — api.cashight.nghuy.link (REST, regional, stage prod)", [
  icon("apigw", "api_gateway", "API Gateway REST"),
  grid("lam", null, "API Lambdas · Node 22 · live alias · CodeDeploy canary · X-Ray", { cols: 3 }, [
    icon("l_sess", "lambda", "session-capabilities"),
    icon("l_upl", "lambda", "uploads (presign)"),
    icon("l_ust", "lambda", "upload-status"),
    icon("l_stm", "lambda", "statements"),
    icon("l_dsh", "lambda", "dashboard"),
    icon("l_sum", "lambda", "summary (stream)"),
    icon("l_ce", "lambda", "cost-explorer"),
    icon("l_inv", "lambda", "aws-invoices"),
    icon("l_isum", "lambda", "aws-invoice-summary"),
  ]),
]);

// ── 4 · data & config ─────────────────────────────────────────────────────────
const data = stage("data", 3, "4 · Data & config", [
  icon("ce", "cost_explorer", "Cost Explorer API"),
  icon("s3ce", "s3", "S3 cost-exports"),
  icon("ssm", "parameter_store", "SSM Parameter Store"),
  icon("ddb", "dynamodb", "DynamoDB single table"),
  icon("s3st", "s3", "S3 statements"),
  ossBox("n_data", "DynamoDB: jobs · metadata · authorization (PK/SK, TTL, PITR, on-demand). S3 statements holds the parsed JSON — the source of truth. SSM SecureString: PDF password map + Gemini API key. S3 cost-exports holds the Cost Explorer CSVs."),
], { gap: 36 });

// ── 5 · async parse pipeline ──────────────────────────────────────────────────
const asyncStage = stage("async", 4, "5 · Async parse pipeline — s3:ObjectCreated on uploads/statements/*.pdf and uploads/aws-invoices/*.pdf → SQS → worker", [
  icon("s3up", "s3", "S3 uploads (raw PDFs)"),
  phantom("queues", "", { dir: "col", gap: 26, header: 0, pad: 0 }, [
    icon("q1", "sqs", "SQS cashight-parse"),
    icon("q2", "sqs", "SQS invoice-parse"),
    icon("dlq", "sqs", "dead-letter queues"),
  ]),
  frame("workers", "Parser workers (Node 22)", { dir: "col", gap: 26 }, [
    icon("w1", "lambda", "parser-worker 1536MB"),
    icon("w2", "lambda", "invoice-parser 2048MB"),
  ]),
], { dir: "row", align: "center" });

// ── cross-cutting: observability ──────────────────────────────────────────────
const obs = band("obs", "Observability — one log group per Lambda + API Gateway access logs (30 d)", [
  icon("cw", "cloudwatch_2", "CloudWatch Logs"),
  icon("xr", "xray", "X-Ray active tracing"),
]);

const region = group("reg", "group_region", "Region · ap-southeast-1", { dir: "col", gap: 30 }, [
  phantom("row1", "", { dir: "row", gap: 40, align: "top", header: 0, pad: 0 }, [auth, api, data]),
  asyncStage,
  obs,
]);

const cloud = group("aws", "group_aws_cloud_alt", "AWS Cloud · account 010382427026",
  { dir: "col", gap: 30 }, [edge, region]);

// ── outside the AWS boundary ──────────────────────────────────────────────────
const extIdp = onpremFrame("extg", "External", [
  ossBox("goauth", "Google OAuth\nfederated IdP"),
]);
const extAi = onpremFrame("exta", "External", [
  ossBox("gemini", "Google Gemini 2.5 Flash\nanonymized aggregates only"),
]);

const cicd = band("cicd", "CI/CD & state", [
  icon("gha", "githubactions", "GitHub Actions"),
  icon("oidc", "identity_and_access_management", "GitHub OIDC → IAM"),
  icon("s3art", "s3", "S3 artifacts (zips)"),
  icon("cd", "codedeploy", "CodeDeploy canary"),
  icon("tfs", "s3", "S3 tfstate (KMS)"),
  ossBox("n_cicd", "The deploy job updates the Lambda functions and runs a CodeDeploy canary on the live alias; the frontend job syncs the static export and invalidates CloudFront."),
], { dir: "col" });

const tree = phantom("root", "", { dir: "row", gap: 56, align: "center", header: 0, pad: 10 }, [
  phantom("left", "", { dir: "col", gap: 40, header: 0, pad: 0 }, [extIdp, users]),
  cloud,
  phantom("right", "", { dir: "col", gap: 40, header: 0, pad: 0 }, [cicd, extAi]),
]);

renderTree(d, tree, [40, 90]);
d.title("Cashight — AWS architecture · static SPA + serverless microservices · ap-southeast-1 · account 010382427026");

// frontend delivery
d.link("users", "r53", "DNS", { role: "fanout", dir: "LR" });
d.link("r53", "cf", "", { flow: true });
d.link("cf", "s3fe", "OAC origin", { flow: true });
d.link("cf", "cffn", "viewer-request", { dash: true });
d.link("acm", "cf", "TLS cert", { dash: true });

// authentication
d.link("users", "cog", "sign-in", { role: "fanout", dir: "LR" });
d.link("cog", "goauth", "federated IdP", { dash: true });
d.link("cog", "guard", "triggers", { dash: true });
d.link("cog", "apigw", "authorizer", { dash: true });

// API layer
d.link("users", "apigw", "REST + JWT", { flow: true, dir: "LR" });
d.link("apigw", "lam", "routes");
d.link("lam", "ddb", "jobs", { role: "fanout" });
d.link("lam", "s3st", "read JSON", { role: "fanout" });
d.link("lam", "ssm", "secrets", { dash: true, role: "fanout" });
d.link("lam", "ce", "billing API", { dash: true, role: "fanout" });
d.link("ce", "s3ce", "");
d.link("lam", "gemini", "aggregates only", { dash: true });

// async parse pipeline
d.link("users", "s3up", "presigned PUT", { flow: true, dir: "LR" });
d.link("s3up", "q1", "", { flow: true, role: "fanout" });
d.link("s3up", "q2", "", { role: "fanout" });
d.link("q1", "w1", "batch", { flow: true });
d.link("q2", "w2", "batch");
d.link("q1", "dlq", "", { dash: true });
d.link("q2", "dlq", "", { dash: true });
d.link("workers", "s3st", "parsed JSON", { flow: true, role: "fanout" });
d.link("workers", "ddb", "job status", { role: "fanout" });

// CI/CD
d.link("gha", "oidc", "OIDC", { dash: true });
d.link("gha", "s3art", "Lambda zips");
d.link("s3art", "cd", "");
d.link("gha", "s3fe", "sync + invalidate", { dash: true });

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(new URL("./cashight-aws-architecture.drawio", import.meta.url), d.mxfile("Cashight AWS architecture"));

// Self-check tail (from `drawio-ai scaffold`): one run = build + validate + render + issues.
import { execFileSync as __exec } from "node:child_process";
try {
  const __f = new URL("./cashight-aws-architecture.drawio", import.meta.url).pathname;
  console.log(__exec("drawio-ai", ["render", __f, "--check", "--page", "1", "-o", __f + ".png"], { encoding: "utf8" }).trim());
} catch (e) { console.error("RENDER-SKIPPED:", String(e.message).split("\n")[0]); }
