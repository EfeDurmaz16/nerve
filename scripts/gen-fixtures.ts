/**
 * Generate examples/openai-traces/*.jsonl — 50 traces total:
 *   • 19 successes (a SQL-generation agent producing correct queries)
 *   • 14 failures in cluster "schema_hallucination" (no such column)
 *   • 11 failures in cluster "missing_join" (cartesian product / missing JOIN ... ON)
 *   •  6 failures in cluster "wrong_agg" (used SUM where AVG required, etc.)
 *
 * Output shape per line is OpenAI-style chat completion log with optional `failure`
 * and `outcome` fields, which the @nerve/importers package normalizes.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../examples/openai-traces");
mkdirSync(outDir, { recursive: true });

interface Rec {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  output: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  usd: number;
  latency_ms: number;
  failure?: string;
  outcome?: "success" | "failure";
}

const sysPrompt =
  "You are a SQL generation assistant. Produce a single SQL statement that answers the user's request using only the columns and tables they provide.";

function rec(intent: string, output: string, failure?: string, model = "claude-haiku-4-5"): Rec {
  const r: Rec = {
    model,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: intent },
    ],
    output,
    usage: { prompt_tokens: 180, completion_tokens: 60 },
    usd: 0.0008,
    latency_ms: 420,
  };
  if (failure) {
    r.failure = failure;
    r.outcome = "failure";
  } else {
    r.outcome = "success";
  }
  return r;
}

// ─── Cluster 1: schema_hallucination (14) ────────────────────────────────────
const c1: Rec[] = [
  rec(
    "Get the first names of all users. Schema: users(id, first_name, last_name).",
    "SELECT users.firstname FROM users",
    "no such column: users.firstname",
  ),
  rec(
    "List user emails. Schema: users(id, email, name).",
    "SELECT users.email_address FROM users",
    "no such column: users.email_address",
  ),
  rec(
    "Show me product titles. Schema: products(id, title, price).",
    "SELECT products.name FROM products",
    "no such column: products.name (did you mean title?)",
  ),
  rec(
    "List order totals. Schema: orders(id, total_cents, created_at).",
    "SELECT orders.total FROM orders",
    "no such column: orders.total",
  ),
  rec(
    "Get account balances. Schema: accounts(id, balance_usd, owner_id).",
    "SELECT accounts.balance FROM accounts",
    "no such column: accounts.balance",
  ),
  rec(
    "List company names. Schema: companies(id, legal_name, country).",
    "SELECT companies.name FROM companies",
    "no such column: companies.name (did you mean legal_name?)",
  ),
  rec(
    "Get the dates of all invoices. Schema: invoices(id, issued_on, amount_cents).",
    "SELECT invoices.date FROM invoices",
    "no such column: invoices.date",
  ),
  rec(
    "List employee phone numbers. Schema: employees(id, phone_e164).",
    "SELECT employees.phone_number FROM employees",
    "no such column: employees.phone_number",
  ),
  rec(
    "Show ticket titles. Schema: tickets(id, subject, opened_at).",
    "SELECT tickets.title FROM tickets",
    "no such column: tickets.title (did you mean subject?)",
  ),
  rec(
    "Get the publication years. Schema: books(id, title, published_year).",
    "SELECT books.year FROM books",
    "no such column: books.year",
  ),
  rec(
    "List vehicle registration plates. Schema: vehicles(id, license_plate, color).",
    "SELECT vehicles.plate FROM vehicles",
    "no such column: vehicles.plate",
  ),
  rec(
    "Show transaction amounts. Schema: transactions(id, amount_cents, currency).",
    "SELECT transactions.amount FROM transactions",
    "no such column: transactions.amount",
  ),
  rec(
    "Get the timestamps of events. Schema: events(id, occurred_at, kind).",
    "SELECT events.timestamp FROM events",
    "no such column: events.timestamp",
  ),
  rec(
    "Show the brand names. Schema: cars(id, manufacturer, model).",
    "SELECT cars.brand FROM cars",
    "no such column: cars.brand (did you mean manufacturer?)",
  ),
];

// ─── Cluster 2: missing_join (11) ────────────────────────────────────────────
const c2: Rec[] = [
  rec(
    "Show each user's order count. Schema: users(id,name), orders(id,user_id).",
    "SELECT users.name, COUNT(*) FROM users, orders GROUP BY users.name",
    "missing join: cartesian product detected between users and orders",
  ),
  rec(
    "List products with their category. Schema: products(id,name,category_id), categories(id,label).",
    "SELECT products.name, categories.label FROM products, categories",
    "missing join: cartesian product between products and categories",
  ),
  rec(
    "Show authors and their books. Schema: authors(id,name), books(id,author_id,title).",
    "SELECT authors.name, books.title FROM authors, books",
    "missing join: cartesian product between authors and books",
  ),
  rec(
    "List comments with the post title. Schema: posts(id,title), comments(id,post_id,body).",
    "SELECT posts.title, comments.body FROM posts, comments",
    "missing join: cartesian product between posts and comments",
  ),
  rec(
    "Get the patient and their primary doctor. Schema: patients(id,name,doctor_id), doctors(id,name).",
    "SELECT patients.name, doctors.name FROM patients, doctors",
    "missing join: cartesian product between patients and doctors",
  ),
  rec(
    "Show invoices with the customer name. Schema: invoices(id,customer_id,amount), customers(id,name).",
    "SELECT invoices.amount, customers.name FROM invoices, customers",
    "missing join: cartesian product between invoices and customers",
  ),
  rec(
    "List shipments with destination warehouse. Schema: shipments(id,warehouse_id), warehouses(id,city).",
    "SELECT shipments.id, warehouses.city FROM shipments, warehouses",
    "missing join: cartesian product between shipments and warehouses",
  ),
  rec(
    "Show employees and their department. Schema: employees(id,name,dept_id), departments(id,name).",
    "SELECT employees.name, departments.name FROM employees, departments",
    "missing join: cartesian product between employees and departments",
  ),
  rec(
    "List tickets with assigned agent. Schema: tickets(id,agent_id), agents(id,name).",
    "SELECT tickets.id, agents.name FROM tickets, agents",
    "missing join: cartesian product between tickets and agents",
  ),
  rec(
    "List students with enrolled course. Schema: students(id,name), enrollments(student_id,course_id), courses(id,title).",
    "SELECT students.name, courses.title FROM students, enrollments, courses",
    "missing join: cartesian product between students/enrollments/courses",
  ),
  rec(
    "Show vehicles and current driver. Schema: vehicles(id,driver_id), drivers(id,name).",
    "SELECT vehicles.id, drivers.name FROM vehicles, drivers",
    "missing join: cartesian product between vehicles and drivers",
  ),
];

// ─── Cluster 3: wrong_agg (6) ────────────────────────────────────────────────
const c3: Rec[] = [
  rec(
    "Compute the average order amount. Schema: orders(amount_cents).",
    "SELECT SUM(amount_cents) FROM orders",
    "wrong aggregate function: expected AVG, got SUM",
  ),
  rec(
    "What is the median price? Schema: products(price).",
    "SELECT AVG(price) FROM products",
    "wrong aggregate function: median requested but AVG used",
  ),
  rec(
    "Compute the maximum salary. Schema: employees(salary).",
    "SELECT SUM(salary) FROM employees",
    "wrong aggregate function: expected MAX, got SUM",
  ),
  rec(
    "Find the minimum balance. Schema: accounts(balance_usd).",
    "SELECT AVG(balance_usd) FROM accounts",
    "wrong aggregate function: expected MIN, got AVG",
  ),
  rec(
    "Compute the average review rating. Schema: reviews(rating).",
    "SELECT SUM(rating) FROM reviews",
    "wrong aggregate function: expected AVG, got SUM",
  ),
  rec(
    "Find the highest temperature recorded. Schema: readings(temp).",
    "SELECT AVG(temp) FROM readings",
    "wrong aggregate function: expected MAX, got AVG",
  ),
];

// ─── Successes (19) ──────────────────────────────────────────────────────────
const ok: Rec[] = Array.from({ length: 19 }, (_, i) =>
  rec(
    `Successful task #${i + 1}: count rows in table users.`,
    "SELECT COUNT(*) FROM users",
  ),
);

const all = [...c1, ...c2, ...c3, ...ok];

// Shuffle so they land out of order, like a real log.
function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  let s = seed;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const shuffled = shuffleSeeded(all, 0xdeadbeef);

// Write as a small set of files so the demo's `import examples/openai-traces/*.jsonl` glob works.
const fileCount = 5;
const perFile = Math.ceil(shuffled.length / fileCount);
for (let f = 0; f < fileCount; f++) {
  const slice = shuffled.slice(f * perFile, (f + 1) * perFile);
  const path = resolve(outDir, `traces_${String(f + 1).padStart(2, "0")}.jsonl`);
  writeFileSync(path, slice.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

console.log(`✓ wrote ${shuffled.length} traces across ${fileCount} files in ${outDir}`);
console.log(`  clusters seeded:  schema_hallucination=${c1.length}  missing_join=${c2.length}  wrong_agg=${c3.length}  successes=${ok.length}`);
